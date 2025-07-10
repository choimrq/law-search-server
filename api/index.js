// File: /api/index.js
// This file will serve as the default API endpoint for https://law-search-server.vercel.app/api

const axios = require('axios');
const convert = require('xml-js');
const cheerio = require('cheerio'); // Import cheerio for HTML parsing

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
        const { query } = req.query; // Get the search query from the request URL parameters

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

        // --- 1단계: 판례 목록 검색 API 호출 (lawSearch.do) ---
        const searchApiUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=prec&type=XML&query=${encodeURIComponent(query)}&display=100`;

        console.log(`[DEBUG] 1단계: 판례 목록 API 호출 시도: ${searchApiUrl}`);

        const searchResponse = await axios.get(searchApiUrl);
        const searchXmlData = searchResponse.data;

        // Check if the response is an HTML page (indicating an error from the API itself)
        if (typeof searchXmlData === 'string' && searchXmlData.trim().startsWith('<!DOCTYPE html')) {
            console.error('[ERROR] 1단계: 국가법령정보 API가 HTML 오류 페이지를 반환했습니다. API 키 또는 요청을 확인하세요.');
            return res.status(500).json({
                error: '국가법령정보 API 오류: 예상치 못한 HTML 응답 (목록 검색)',
                details: 'API 키가 유효하지 않거나, 요청이 잘못되었을 수 있습니다. 법제처에 문의하여 API 키를 확인해주세요.'
            });
        }

        const searchJsonData = convert.xml2json(searchXmlData, { compact: true, spaces: 4 });
        const searchParsedData = JSON.parse(searchJsonData);

        let precList = searchParsedData.PrecSearch?.prec || [];
        if (precList && !Array.isArray(precList)) {
            precList = [precList]; // Convert single object to an array for consistent processing
        }

        console.log(`[DEBUG] 1단계: 검색된 판례 수: ${precList.length}`);

        // --- 2단계: 각 판례의 상세 링크(HTML)를 크롤링하여 전문(fullText) 가져오기 ---
        const formattedCases = await Promise.all(precList.map(async (item) => {
            const caseId = item.판례일련번호?._text || '';
            const detailHtmlLink = item.판례상세링크?._text || ''; // Get the HTML detail link
            let fullTextContent = '판결문 전문을 가져올 수 없습니다.'; // Default message if fetching/parsing fails

            if (caseId && detailHtmlLink) {
                console.log(`[DEBUG] 2단계: 판례 상세 HTML 링크 크롤링 시도 (ID: ${caseId}): ${detailHtmlLink}`);

                try {
                    const detailResponse = await axios.get(detailHtmlLink);
                    const htmlData = detailResponse.data;

                    // Check if the response is valid HTML (not an error page)
                    if (typeof htmlData === 'string' && htmlData.trim().startsWith('<!DOCTYPE html')) {
                        // Load HTML into cheerio for parsing
                        const $ = cheerio.load(htmlData);

                        // *** IMPORTANT: This selector needs to be accurate for the actual law.go.kr HTML structure ***
                        // Based on typical law.go.kr judgment pages, the full text is often within a `div`
                        // with a class like 'txt_view' or 'content_view'.
                        // We will try 'div.txt_view' first, then 'div.content_view', then fallback to body text.
                        let extractedText = '';
                        let $contentDiv = $('div.txt_view'); 

                        if ($contentDiv.length === 0) {
                            $contentDiv = $('div.content_view');
                        }
                        if ($contentDiv.length === 0) {
                            // Fallback: get all text from a likely content area within the body
                            // This might need refinement based on actual HTML
                            $contentDiv = $('body'); // Fallback to body if specific divs not found
                        }

                        if ($contentDiv.length > 0) {
                            extractedText = $contentDiv.text().trim();
                            // Basic cleanup: remove multiple newlines, leading/trailing whitespace
                            extractedText = extractedText.replace(/\n\s*\n/g, '\n\n').trim();
                        } else {
                            extractedText = '판결문 전문을 추출할 수 없습니다. HTML 구조를 확인해주세요.';
                        }
                        
                        if (extractedText === '') {
                            fullTextContent = '판결문 전문 내용이 없습니다.';
                        } else {
                            fullTextContent = extractedText;
                        }

                        console.log(`[DEBUG] 2단계: 판결문 전문 추출 완료 (ID: ${caseId}), 길이: ${fullTextContent.length}`);

                    } else {
                        // If the response is not valid HTML, it's still an issue.
                        console.warn(`[WARN] 2단계: 상세 판례 API (ID: ${caseId})가 예상치 못한 응답을 반환했습니다 (HTML 아님).`);
                        fullTextContent = '판결문 전문을 가져오는 중 오류 발생 (예상치 못한 API 응답).';
                    }
                } catch (detailError) {
                    console.error(`[ERROR] 2단계: 판례 상세 HTML 크롤링 중 에러 발생 (ID: ${caseId}):`, detailError.message);
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
                summary: item.판시사항?._cdata || '요약 정보 없음', // 판시사항을 요약으로 사용
                fullText: fullTextContent, // 크롤링하여 가져온 판결문 전문
                link: detailHtmlLink // 원본 상세 HTML 링크
            };
        }));

        // Send the formatted results back to the frontend
        res.status(200).json({ results: formattedCases }); // Wrap in 'results' object as expected by frontend

    } catch (error) {
        console.error('백엔드 서버 내부 오류 발생:', error.message);
        res.status(500).json({ error: '판례 정보를 가져오는 데 실패했습니다.', details: error.message });
    }
};
