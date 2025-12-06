const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(__dirname));

// Proxy endpoint for search
app.get('/proxy', async (req, res) => {
    try {
        const targetUrl = 'https://www.supremecourt.gov.bd/web/index.php';

        // Forward all query parameters from the request
        const response = await axios.get(targetUrl, {
            params: req.query,
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        let html = response.data;

        // Optionally, we can do some basic absolute URL fixing here to make the client's life easier,
        // but our client script has robust logic now. 
        // We WILL fix the relative paths for resources (css/img) just in case we ever wanted to render it, 
        // even though we are just parsing data now.
        const baseUrl = 'https://www.supremecourt.gov.bd/web/';

        // return the html
        res.send(html);

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send(`Error fetching results: ${error.message}`);
    }
});

// Proxy endpoint for PDFs
app.get('/proxy-pdf', async (req, res) => {
    try {
        const pdfUrl = req.query.url;
        if (!pdfUrl) {
            return res.status(400).send('Missing URL parameter');
        }

        const response = await axios({
            method: 'get',
            url: pdfUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // Set headers to force inline display
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');

        // Pipe the PDF stream to the client
        response.data.pipe(res);

    } catch (error) {
        console.error('PDF Proxy Error:', error.message);
        res.status(500).send('Error fetching PDF');
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
