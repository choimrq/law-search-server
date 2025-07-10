// File: /api/index.js
// This file will serve as the default API endpoint for https://law-search-server.vercel.app/api

const axios = require('axios');
const convert = require('xml-js');

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

        // Construct the target URL for the National Law Information API
        const targetUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=prec&type=XML&query=${encodeURIComponent(query)}&display=100`;

        console.log(`[DEBUG] 국가법령정보 API 호출 시도: ${targetUrl}`); // 디버깅 로그

        // Make the HTTP request to the National Law Information API
        const response = await axios.get(targetUrl);
        const xmlData = response.data; // Get XML data from the response

        console.log(`[DEBUG] 국가법령정보 API로부터 받은 원본 XML 데이터:`); // 디버깅 로그
        console.log(xmlData); // 원본 XML 데이터를 로그로 출력

        // Convert XML data to JSON
        const jsonData = convert.xml2json(xmlData, { compact: true, spaces: 4 });
        const parsedData = JSON.parse(jsonData);

        console.log(`[DEBUG] XML을 JSON으로 변환된 데이터:`); // 디버깅 로그
        console.log(parsedData); // 변환된 JSON 데이터를 로그로 출력

        // Extract and format the legal case list from the parsed data
        let precList = parsedData.PrecSearch?.prec || [];
        if (precList && !Array.isArray(precList)) {
            precList = [precList]; // Convert single object to an array for consistent processing
        }

        // Map the raw API response items to a more user-friendly format
        const formattedCases = precList.map(item => ({
            id: item.판례일련번호?._text || '',
            caseNumber: item.사건번호?._text || '번호 없음',
            title: item.사건명?._text || '제목 없음',
            courtName: item.법원명?._text || '법원 없음',
            caseType: item.사건종류명?._text || '종류 없음',
            decisionDate: item.선고일자?._text || '날짜 없음',
            summary: item.판시사항?._cdata || '요약 정보 없음',
            fullText: item.판결요지?._cdata || '상세 정보 없음',
            link: `https://www.law.go.kr/DRF/lawService.do?OC=${apiKey}&target=prec&ID=${item.판례일련번호?._text || ''}&type=HTML` // Example link, adjust as per API
        }));

        // Send the formatted results back to the frontend
        res.status(200).json({ results: formattedCases }); // Wrap in 'results' object as expected by frontend

    } catch (error) {
        console.error('API 요청 중 에러 발생:', error.message);
        // Provide a more informative error response
        res.status(500).json({ error: '판례 정보를 가져오는 데 실패했습니다.', details: error.message });
    }
};