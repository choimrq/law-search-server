// File: /api/index.js
// This file will serve as the default API endpoint for https://law-search-server.vercel.app/api

const axios = require('axios');
const convert = require('xml-js');
const cheerio = require('cheerio'); // For HTML parsing (only used for 'prec' fullText)

module.exports = async (req, res) => {
    // Set CORS headers to allow requests from any origin (for development)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS requests (CORS preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { query, target } = req.query; // Get search query and target type ('prec' or 'law')

        // Validate if a query is provided
        if (!query) {
            return res.status(400).json({ error: '검색어가 필요합니다.' });
        }

        // Securely retrieve the API key from Vercel Environment Variables.
        const apiKey = process.env.LAW_API_KEY;
        if (!apiKey) {
            console.error('서버에 LAW_API_KEY 환경 변수가 설정되지 않았습니다.');
            return res.status(500).json({ error: '서버 설정 오류: API 키가 누락되었습니다.' });
        }

        let formattedResults = [];

        if (target === 'prec') {
            // --- 판례 검색 로직 (기존 로직 유지) ---
            const searchApiUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=prec&type=XML&query=${encodeURIComponent(query)}&display=100`;

            console.log(`[DEBUG] 판례 검색 (1단계): 판례 목록 API 호출 시도: ${searchApiUrl}`);

            const searchResponse = await axios.get(searchApiUrl);
            const searchXmlData = searchResponse.data;

            if (typeof searchXmlData === 'string' && searchXmlData.trim().startsWith('<!DOCTYPE html')) {
                console.error('[ERROR] 판례 검색 (1단계): 국가법령정보 API가 HTML 오류 페이지를 반환했습니다. API 키 또는 요청을 확인하세요.');
                return res.status(500).json({
                    error: '국가법령정보 API 오류: 예상치 못한 HTML 응답 (판례 목록 검색)',
                    details: 'API 키가 유효하지 않거나, 요청이 잘못되었을 수 있습니다. 법제처에 문의하여 API 키를 확인해주세요.'
                });
            }

            const searchJsonData = convert.xml2json(searchXmlData, { compact: true, spaces: 4 });
            const searchParsedData = JSON.parse(searchJsonData);

            let precList = searchParsedData.PrecSearch?.prec || [];
            if (precList && !Array.isArray(precList)) {
                precList = [precList];
            }

            console.log(`[DEBUG] 판례 검색 (1단계): 검색된 판례 수: ${precList.length}`);

            formattedResults = await Promise.all(precList.map(async (item) => {
                const caseId = item.판례일련번호?._text || '';
                const detailHtmlLink = item.판례상세링크?._text || '';
                let fullTextContent = '판결문 전문을 가져올 수 없습니다.';

                if (caseId && detailHtmlLink) {
                    console.log(`[DEBUG] 판례 검색 (2단계): 판례 상세 HTML 링크 크롤링 시도 (ID: ${caseId}): ${detailHtmlLink}`);

                    try {
                        const detailResponse = await axios.get(detailHtmlLink);
                        const htmlData = detailResponse.data;

                        if (typeof htmlData === 'string' && htmlData.trim().startsWith('<!DOCTYPE html')) {
                            const $ = cheerio.load(htmlData);
                            let extractedText = '';
                            let $contentDiv = $('div.txt_view'); 

                            if ($contentDiv.length === 0) {
                                $contentDiv = $('div.content_view');
                            }
                            if ($contentDiv.length === 0) {
                                $contentDiv = $('body'); 
                            }

                            if ($contentDiv.length > 0) {
                                extractedText = $contentDiv.text().trim();
                                extractedText = extractedText.replace(/\n\s*\n/g, '\n\n').trim(); 
                            } else {
                                extractedText = '판결문 전문을 추출할 수 없습니다. HTML 구조를 확인해주세요.';
                            }
                            
                            if (extractedText === '') {
                                fullTextContent = '판결문 전문 내용이 없습니다.';
                            } else {
                                fullTextContent = extractedText;
                            }
                            console.log(`[DEBUG] 판례 검색 (2단계): 판결문 전문 추출 완료 (ID: ${caseId}), 길이: ${fullTextContent.length}`);

                        } else {
                            console.warn(`[WARN] 판례 검색 (2단계): 상세 판례 API (ID: ${caseId})가 예상치 못한 응답을 반환했습니다 (HTML 아님).`);
                            fullTextContent = '판결문 전문을 가져오는 중 오류 발생 (예상치 못한 API 응답).';
                        }
                    } catch (detailError) {
                        console.error(`[ERROR] 판례 검색 (2단계): 판례 상세 HTML 크롤링 중 에러 발생 (ID: ${caseId}):`, detailError.message);
                        fullTextContent = `판결문 전문을 가져오는 데 실패했습니다: ${detailError.message}`;
                    }
                }

                return {
                    id: caseId,
                    caseNumber: item.사건번호?._text || '번호 없음',
                    title: item.사건명?._text || '제목 없음',
                    courtName: item.법원명?._text || '법원 없음',
                    caseType: item.사건종류명?._text || '종류 없음',
                    decisionDate: item.선고일자?._text || '날짜 없음',
                    summary: item.판시사항?._cdata || '요약 정보 없음',
                    fullText: fullTextContent,
                    link: detailHtmlLink
                };
            }));
        } else if (target === 'law') {
            // --- 법령 검색 로직 ---
            const lawSearchApiUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=law&type=XML&query=${encodeURIComponent(query)}&display=100`;

            console.log(`[DEBUG] 법령 검색: 법령 목록 API 호출 시도: ${lawSearchApiUrl}`);

            const lawSearchResponse = await axios.get(lawSearchApiUrl);
            const lawSearchXmlData = lawSearchResponse.data;

            if (typeof lawSearchXmlData === 'string' && lawSearchXmlData.trim().startsWith('<!DOCTYPE html')) {
                console.error('[ERROR] 법령 검색: 국가법령정보 API가 HTML 오류 페이지를 반환했습니다. API 키 또는 요청을 확인하세요.');
                return res.status(500).json({
                    error: '국가법령정보 API 오류: 예상치 못한 HTML 응답 (법령 목록 검색)',
                    details: 'API 키가 유효하지 않거나, 요청이 잘못되었을 수 있습니다. 법제처에 문의하여 API 키를 확인해주세요.'
                });
            }

            const lawSearchJsonData = convert.xml2json(lawSearchXmlData, { compact: true, spaces: 4 });
            const lawSearchParsedData = JSON.parse(lawSearchJsonData);

            let lawList = lawSearchParsedData.LawSearch?.law || [];
            if (lawList && !Array.isArray(lawList)) {
                lawList = [lawList];
            }

            console.log(`[DEBUG] 법령 검색: 검색된 법령 수: ${lawList.length}`);

            formattedResults = lawList.map(item => {
                const lawDetailLink = item.법령상세링크?._text || '';
                console.log(`[DEBUG] 법령 검색: 법령 상세 링크: ${lawDetailLink}`); // 법령 상세 링크 로그 추가

                return {
                    id: item.법령일련번호?._text || '',
                    title: item.법령명?._text || '제목 정보 없음', // '제목 없음' -> '제목 정보 없음'
                    promulgationNumber: item.공포번호?._text || '번호 없음',
                    promulgationDate: item.공포일자?._text || '날짜 없음',
                    department: item.소관부처?._text || '소관부처 없음',
                    link: lawDetailLink // 법령 상세 링크 제공
                };
            });
        } else {
            return res.status(400).json({ error: '유효하지 않은 검색 대상입니다. (target 파라미터 오류)' });
        }

        res.status(200).json({ results: formattedResults });

    } catch (error) {
        console.error('백엔드 서버 내부 오류 발생:', error.message);
        res.status(500).json({ error: '법률 정보를 가져오는 데 실패했습니다.', details: error.message });
    }
};
