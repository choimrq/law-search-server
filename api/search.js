// File: /api/search.js
const axios = require('axios');
const convert = require('xml-js');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: '검색어가 필요합니다.' });
        }

        // Vercel 환경 변수에서 API 키를 안전하게 가져옵니다.
        const apiKey = process.env.LAW_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: '서버에 API 키가 설정되지 않았습니다.' });
        }

        const targetUrl = `https://www.law.go.kr/DRF/lawSearch.do?OC=${apiKey}&target=prec&type=XML&query=${encodeURIComponent(query)}&display=100`;
        
        const response = await axios.get(targetUrl);
        const xmlData = response.data;
        const jsonData = convert.xml2json(xmlData, { compact: true, spaces: 4 });
        const parsedData = JSON.parse(jsonData);

        let precList = parsedData.PrecSearch?.prec || [];
        if (precList && !Array.isArray(precList)) {
            precList = [precList];
        }

        const formattedCases = precList.map(item => ({
            id: item.판례일련번호?._text || '',
            caseNumber: item.사건번호?._text || '번호 없음',
            title: item.사건명?._text || '제목 없음',
            court: item.법원명?._text || '법원 없음',
            caseType: item.사건종류명?._text || '종류 없음',
            date: item.선고일자?._text || '날짜 없음',
            summary: item.판시사항?._cdata || '요약 정보 없음',
            fullText: item.판결요지?._cdata || '상세 정보 없음'
        }));

        res.status(200).json(formattedCases);

    } catch (error) {
        console.error('API 요청 중 에러 발생:', error.message);
        res.status(500).json({ error: '판례 정보를 가져오는 데 실패했습니다.', details: error.message });
    }
};