document.addEventListener('DOMContentLoaded', () => {
    // Variables
    const form = document.getElementById('search-form');
    const searchBtn = document.querySelector('.search-btn');
    // Guard against null if script runs before DOM (though we are in DOMContentLoaded)
    const originalBtnText = searchBtn ? searchBtn.innerHTML : 'Search Records';

    // VIEWS
    const searchView = document.getElementById('search-view');
    const resultsView = document.getElementById('results-view');
    const pdfView = document.getElementById('pdf-view');

    // CONTAINERS
    const resultsGrid = document.getElementById('results-grid');
    const pdfContainer = document.getElementById('pdf-container');
    // const loadingIndicator = document.getElementById('loading-indicator'); // Removed

    // BUTTONS
    const modifySearchBtn = document.getElementById('modify-search-btn');
    const newSearchBtn = document.getElementById('new-search-btn');
    const backToResultsBtn = document.getElementById('back-to-results-btn');
    const printPdfBtn = document.getElementById('print-pdf-btn');
    const downloadPdfBtn = document.getElementById('download-pdf-btn');

    let currentPdfUrl = null;
    let currentPdfTitle = 'Document.pdf';

    // HELPER: Switch Views
    function switchView(viewName) {
        // Hide all
        searchView.classList.add('hidden');
        resultsView.classList.add('hidden');
        pdfView.classList.add('hidden');

        // Show target
        if (viewName === 'search') searchView.classList.remove('hidden');
        if (viewName === 'results') resultsView.classList.remove('hidden');
        if (viewName === 'pdf') pdfView.classList.remove('hidden');

        // Scroll to top
        window.scrollTo(0, 0);
    }

    // FORM SUBMIT
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Validation
        const yearInput = document.getElementById('year');
        if (yearInput.value && (yearInput.value < 1900 || yearInput.value > 2099)) {
            alert('Please enter a valid year between 1900 and 2099');
            yearInput.focus();
            return;
        }

        // Show loading state on button (removed as per request)
        searchBtn.style.opacity = '0.8';
        searchBtn.style.cursor = 'wait';

        // Switch to results view but show loading
        switchView('results');
        resultsGrid.innerHTML = ''; // Clear previous
        // loadingIndicator.classList.remove('hidden'); // Removed loading indicator

        try {
            // Build Query String
            const formData = new FormData(form);
            const params = new URLSearchParams(formData);

            // Fetch from Proxy
            const response = await fetch(`/proxy?${params.toString()}`);
            if (!response.ok) throw new Error('Network response was not ok');

            const htmlText = await response.text();

            parseAndDisplayResults(htmlText);

        } catch (error) {
            console.error(error);
            resultsGrid.innerHTML = `<div class="error-msg">Error fetching results: ${error.message}</div>`;
        } finally {
            // loadingIndicator.classList.add('hidden');
            // Reset button
            // searchBtn.innerHTML = originalBtnText; // No need to reset text if we didn't change it
            searchBtn.style.opacity = '1';
            searchBtn.style.cursor = 'pointer';
        }
    });

    // PARSE & DISPLAY LOGIC (Ported from Server.js)
    function parseAndDisplayResults(html) {
        // Create a dummy parser
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Logic to find results. Conventionally in #div_body or tables
        // The server.js logic looked for links pointing to PDFs (or .pdf)
        // Adjusting logic to be purely client side parsing of the RAW returned HTML

        // Note: The raw HTML from Supreme Court often has relative links. 
        // We need to look for <a href="...pdf">

        const links = Array.from(doc.querySelectorAll('a'));
        const pdfLinks = links.filter(a => a.href.includes('.pdf') || a.textContent.includes('Judgment'));
        // Better heuristic: checks if href ends in .pdf or contains it, but doc parser normalizes links to current domain (localhost)
        // so we check attribute safely

        const validLinks = links.filter(link => {
            const href = link.getAttribute('href');
            return href && (href.toLowerCase().endsWith('.pdf') || href.toLowerCase().includes('.pdf'));
        });

        if (validLinks.length === 0) {
            resultsGrid.innerHTML = '<div class="no-results">No judgments found matching your criteria.</div>';
            return;
        }

        let count = 0;

        validLinks.forEach(link => {
            // HELPER: Clean Text
            const cleanText = (text) => {
                if (!text) return "";
                return text
                    .replace(/["']?অনুবাদ\s*\(Google\)["']?/gi, '')
                    .replace(/["']?Translation\s*\(Google\)["']?/gi, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim();
            };

            const rawTitle = link.textContent.trim();

            // STRICT FILTER
            if (rawTitle.includes('অনুবাদ') || (rawTitle.toLowerCase().includes('translation') && rawTitle.toLowerCase().includes('google'))) {
                return;
            }

            let title = cleanText(rawTitle);
            if (!title) return;

            // Resolve proper URL for proxying
            let pdfUrl = link.getAttribute('href');
            if (!pdfUrl.startsWith('http')) {
                if (pdfUrl.startsWith('../')) {
                    pdfUrl = 'https://www.supremecourt.gov.bd/' + pdfUrl.replace('../', '');
                } else {
                    pdfUrl = 'https://www.supremecourt.gov.bd/web/' + pdfUrl;
                }
            }

            // TABLE STRUCTURE PARSING
            // Verified Structure: 
            // Cell 0: ID (1, 2...)
            // Cell 1: Case Number (contains Title Link, Translation Link, Uploaded on, From)
            // Cell 2: Parties
            // Cell 3: Short Description

            const row = link.closest('tr');
            if (!row || row.cells.length < 3) {
                // Fallback if structure isn't a standard table row or missing cells
                return;
            }

            // EXTRACT PARTIES (Column 3 -> Index 2)
            let partiesRaw = "";
            if (row.cells.length > 2) {
                partiesRaw = row.cells[2].innerText || row.cells[2].textContent;
            }
            let parties = cleanText(partiesRaw);

            // EXTRACT DATE & COURT (Column 2 -> Index 1)
            let caseInfoText = row.cells[1].innerText || row.cells[1].textContent;
            caseInfoText = caseInfoText.replace(/\s+/g, ' ').trim();

            let uploadedOn = "";
            let fromCourt = "";

            const uploadMatch = caseInfoText.match(/Uploaded on\s*[\:\-]?\s*([^F]+)/i);
            // Capture until "From" or end. rough match.
            // Better: 'Uploaded on :' ... 'From :'

            // Re-parsing strictly from the text content of cell 1
            const uploadIndex = caseInfoText.indexOf("Uploaded on");
            const fromIndex = caseInfoText.indexOf("From");

            if (uploadIndex !== -1) {
                let endOfDate = fromIndex !== -1 ? fromIndex : caseInfoText.length;
                let dateChunk = caseInfoText.substring(uploadIndex, endOfDate);
                // content is like "Uploaded on : 08-SEP-25"
                uploadedOn = dateChunk.replace(/Uploaded on\s*[\:\-]?/i, '').trim();
            }

            if (fromIndex !== -1) {
                let courtChunk = caseInfoText.substring(fromIndex);
                fromCourt = courtChunk.replace(/From\s*[\:\-]?/i, '').trim();
            }

            // CLEAN DETAILS
            uploadedOn = cleanText(uploadedOn);
            fromCourt = cleanText(fromCourt);

            // Additional Filters
            const lowerParties = parties.toLowerCase();
            if (lowerParties.includes('bijoy 71') || (lowerParties.includes('uploaded on') && lowerParties.length < 50)) {
                // This might happen if cells are merged or layout shift. 
                // But generally safe to ignore if it looks purely administrative.
            }

            // Create Card
            const card = document.createElement('div');
            card.className = 'result-card';
            card.innerHTML = `
                <div class="card-title">${title}</div>
                ${parties ? `<div class="card-parties">${parties}</div>` : ''}
                ${uploadedOn ? `<div class="card-stat-row"><span class="stat-label">Uploaded on :</span> ${uploadedOn}</div>` : ''}
                ${fromCourt ? `<div class="card-stat-row"><span class="stat-label">From :</span> ${fromCourt}</div>` : ''}
            `;

            // CLICK HANDLER -> OPEN PDF VIEW
            card.addEventListener('click', () => {
                openPdfView(title, pdfUrl);
            });

            resultsGrid.appendChild(card);
            count++;
        });

        if (count === 0) {
            resultsGrid.innerHTML = '<div class="no-results">No valid cards found after filtering.</div>';
        }
    }

    // PDF VIEW LOGIC
    function openPdfView(title, url) {
        const titleEl = document.getElementById('current-doc-title');
        titleEl.textContent = title;

        // Use proxy-pdf endpoint to avoid CORS and MIXED CONTENT issues
        // We pass the absolute SC URL to our local proxy
        const proxyUrl = `/proxy-pdf?url=${encodeURIComponent(url)}`;

        // Store for actions
        currentPdfUrl = proxyUrl;
        currentPdfTitle = title || 'Judgment';

        renderPDF(proxyUrl);
        switchView('pdf');
    }

    // NAVIGATION BUTTONS
    modifySearchBtn.addEventListener('click', () => {
        switchView('search');
        // Inputs are preserved
    });

    newSearchBtn.addEventListener('click', () => {
        form.reset();
        // Also clear custom combobox
        document.getElementById('case_type_input').value = '';
        document.getElementById('case_type_id').value = '';

        switchView('search');
    });

    backToResultsBtn.addEventListener('click', () => {
        pdfContainer.innerHTML = ''; // Clear to stop memory/audio/video
        switchView('results');
    });

    // PRINT FUNCTIONALITY
    printPdfBtn.addEventListener('click', async () => {
        if (!currentPdfUrl) return;

        const originalText = printPdfBtn.innerHTML;
        printPdfBtn.innerHTML = 'Preparing...';
        printPdfBtn.disabled = true;

        try {
            // Fetch original
            const response = await fetch(currentPdfUrl);
            const arrayBuffer = await response.arrayBuffer();

            // VALIDATE MAGIC BYTES (%PDF)
            const headerArr = new Uint8Array(arrayBuffer.slice(0, 5));
            const headerStr = String.fromCharCode(...headerArr);
            if (!headerStr.startsWith('%PDF-')) {
                console.error("Invalid PDF Structure. Header:", headerStr);
                alert('Cannot print: The source file is not a valid PDF.');
                printPdfBtn.disabled = false;
                printPdfBtn.innerHTML = originalText;
                return;
            }

            // Add Footer
            const modifiedPdfBytes = await addFooterToPdf(arrayBuffer);

            // Create Blob URL for the modified PDF
            const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
            const blobUrl = URL.createObjectURL(blob);

            // Create a hidden iframe
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = blobUrl;
            document.body.appendChild(iframe);

            iframe.onload = function () {
                try {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                } catch (e) {
                    console.error("Print failed", e);
                    alert("Could not print the document directly. Please try downloading it.");
                }
                // Cleanup after a delay (enough for print dialog to show)
                // Extended to 5 minutes (300000ms) to prevent closing while user is selecting printer
                setTimeout(() => {
                    document.body.removeChild(iframe);
                    URL.revokeObjectURL(blobUrl);
                }, 300000);
            };
        } catch (error) {
            console.error("Print generation error:", error);
            alert("Error preparing document for print.");
        } finally {
            printPdfBtn.innerHTML = originalText;
            printPdfBtn.disabled = false;
        }
    });

    // DOWNLOAD FUNCTIONALITY
    downloadPdfBtn.addEventListener('click', async () => {
        if (!currentPdfUrl) return;

        const originalText = downloadPdfBtn.innerHTML;
        downloadPdfBtn.innerHTML = 'Downloading...';
        downloadPdfBtn.disabled = true;

        try {
            const response = await fetch(currentPdfUrl);
            if (!response.ok) throw new Error('Network response was not ok');

            // Check content type to warn if not PDF
            const contentType = response.headers.get('content-type');
            if (contentType && !contentType.includes('pdf') && !contentType.includes('stream')) {
                console.warn("Fetched document might not be a PDF:", contentType);
                // We won't block purely on header as some servers are misconfigured, but valid PDFs must have %PDF signature
            }

            const arrayBuffer = await response.arrayBuffer();

            // VALIDATE MAGIC BYTES (%PDF)
            const headerArr = new Uint8Array(arrayBuffer.slice(0, 5));
            const headerStr = String.fromCharCode(...headerArr);
            if (!headerStr.startsWith('%PDF-')) {
                console.error("Invalid PDF Structure. Header:", headerStr);

                // If it looks like HTML, it's likely an error page
                if (headerStr.trim().startsWith('<') || headerStr.includes('html')) {
                    alert('The requested document is not available properly (Source returned HTML error).');
                } else {
                    alert('The source file is not a valid PDF.');
                }
                return; // Stop execution
            }

            // Add Footer
            const modifiedPdfBytes = await addFooterToPdf(arrayBuffer);

            const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            // Ensure filename ends in .pdf
            // Logic to be extremely safe with filename
            const timestamp = new Date().getTime();
            let safeName = "Digital_BLD_Judgment";

            // Try to add a bit of the title if safe
            if (currentPdfTitle) {
                // Take only first 20 alphanumeric chars
                const clean = currentPdfTitle.toString().replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
                if (clean.length > 0) safeName += "_" + clean;
            }

            let filename = `${safeName}_${timestamp}.pdf`;

            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            setTimeout(() => document.body.removeChild(a), 100);
        } catch (error) {
            console.error('Download error:', error);
            alert('Failed to download PDF.');
        } finally {
            downloadPdfBtn.innerHTML = originalText;
            downloadPdfBtn.disabled = false;
        }
    });

    // PDF MODIFICATION HELPER
    async function addFooterToPdf(pdfArrayBuffer) {
        try {
            // Ensure PDFLib is available
            if (typeof PDFLib === 'undefined') {
                console.error("PDFLib not loaded");
                return pdfArrayBuffer;
            }

            const { PDFDocument, StandardFonts, rgb } = PDFLib;
            const pdfDoc = await PDFDocument.load(pdfArrayBuffer);

            // Embed the font - CRITICAL for text drawing
            const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

            const pages = pdfDoc.getPages();

            // Format Date: "Printed on: DD-MMM-YYYY HH:MM AM/PM"
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
            const footerText = `Printed on: ${dateStr} ${timeStr} | (C) Copyright to Sheikh Hamza`;

            // Draw on each page
            pages.forEach(page => {
                const { width, height } = page.getSize();
                // Draw text at bottom center
                page.drawText(footerText, {
                    x: 20,
                    y: 10,
                    size: 9,
                    font: helveticaFont,
                    color: rgb(0, 0, 0),
                });
            });

            const savedBytes = await pdfDoc.save();

            // Post-save validation: Check if it still has %PDF
            if (savedBytes.length > 5) {
                const header = String.fromCharCode(...savedBytes.slice(0, 5));
                if (!header.startsWith('%PDF-')) {
                    console.error("Modified PDF corrupted header");
                    return pdfArrayBuffer;
                }
            }

            return savedBytes;

        } catch (error) {
            console.error("PDF Lib Error:", error);
            // Fallback: return original if editing fails
            return pdfArrayBuffer;
        }
    }

    // Combobox Logic (rest of file remains)
    const caseTypeInput = document.getElementById('case_type_input');
    const caseTypeResults = document.getElementById('case_type_results');
    const caseTypeHidden = document.getElementById('case_type_id');
    const chevronIcon = document.querySelector('.chevron-down'); // Get icon to make it clickable too if wanted, or just decoration

    // 1. Initialize Options
    const options = Array.from(caseTypeHidden.options)
        .filter(opt => opt.value !== "") // Exclude the placeholder
        .map(opt => ({ value: opt.value, text: opt.text }));

    function filterResults(query) {
        if (!query) return [];
        const lowerQuery = query.toLowerCase();
        // Return full list if clicked/focused empty? Or just matching?
        // User asked for "typing option which will show suggestion", usually implies filtering.
        return options.filter(opt => opt.text.toLowerCase().includes(lowerQuery));
    }

    function showResults(results) {
        caseTypeResults.innerHTML = '';
        if (results.length === 0) {
            caseTypeResults.classList.add('hidden');
            return;
        }

        results.forEach(opt => {
            const li = document.createElement('li');
            li.textContent = opt.text;
            li.addEventListener('click', () => {
                selectOption(opt);
            });
            caseTypeResults.appendChild(li);
        });
        caseTypeResults.classList.remove('hidden');
    }

    function selectOption(opt) {
        caseTypeInput.value = opt.text;
        caseTypeHidden.value = opt.value;
        caseTypeResults.classList.add('hidden');
        caseTypeInput.parentElement.classList.remove('focused'); // Clean up focus state if needed
    }

    caseTypeInput.addEventListener('input', (e) => {
        const query = e.target.value;
        // If empty, clear the hidden value
        if (!query) {
            caseTypeHidden.value = "";
            caseTypeResults.classList.add('hidden');
            return;
        }
        const results = filterResults(query);
        showResults(results);
    });

    // Show all on click if empty? Or just focus
    caseTypeInput.addEventListener('focus', () => {
        if (caseTypeInput.value.trim() !== "") {
            const results = filterResults(caseTypeInput.value);
            showResults(results);
        } else {
            // Optional: Show all if empty? User requirement said "typing option", but usually showing top 10 on click is nice.
            // Let's mimic standard behavior: show all or top valid ones.
            showResults(options);
        }
    });

    // Hide when clicking outside
    document.addEventListener('click', (e) => {
        if (!caseTypeInput.contains(e.target) && !caseTypeResults.contains(e.target)) {
            caseTypeResults.classList.add('hidden');
        }
    });

    // STRICT VALIDATION ON BLUR
    caseTypeInput.addEventListener('blur', () => {
        // Wait slight bit for click event on result list to process first
        setTimeout(() => {
            const currentText = caseTypeInput.value;
            if (!currentText) return; // Empty is fine (no selection)

            // Check for exact text match (case insensitive? usually title case stored so exact match logic or strict)
            // requirement: "only allow the enlisted case type if match"
            const match = options.find(opt => opt.text.toLowerCase() === currentText.toLowerCase());

            if (match) {
                // Determine formatted text (e.g. user typed "writ" -> "Writ Petition")
                caseTypeInput.value = match.text;
                caseTypeHidden.value = match.value;
            } else {
                // No match found
                // Alert or just clear? Clearing is standard strict behavior.
                // alert("Please select a valid Case Type from the list."); // Getting annoying if tab away
                caseTypeInput.value = "";
                caseTypeHidden.value = "";
            }
        }, 200);
    });

    // Reset Button Logic
    document.getElementById('reset-btn').addEventListener('click', () => {
        // Clear all inputs
        form.reset();

        // Explicitly clear special fields that might not be caught by form.reset() standard behavior if value set programmatically
        caseTypeInput.value = '';
        caseTypeHidden.value = '';

        // Optional: Hide results if you want to cleanly reset state
        // resultsContainer.classList.add('hidden'); 
    });

    const inputs = document.querySelectorAll('input, select');
    inputs.forEach(input => {
        if (input.id === 'case_type_input') return; // Handled separately
        input.addEventListener('focus', () => {
            input.parentElement.classList.add('focused');
        });

        input.addEventListener('blur', () => {
            input.parentElement.classList.remove('focused');
        });
    });
});

// Add spin animation to global styles via JS for the loading icon
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .animate-spin {
        animation: spin 1s linear infinite;
        margin-right: 8px;
    }
`;
document.head.appendChild(style);

async function renderPDF(url) {
    const pdfContainer = document.getElementById('pdf-container');
    pdfContainer.innerHTML = '<div style="padding:20px;">Loading PDF...</div>';

    try {
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;

        pdfContainer.innerHTML = ''; // Clear loading

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const scale = 1.5;
            const viewport = page.getViewport({ scale: scale });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.className = 'pdf-page';

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            pdfContainer.appendChild(canvas);
            await page.render(renderContext).promise;
        }
    } catch (error) {
        console.error('Error rendering PDF:', error);
        pdfContainer.innerHTML = '<div style="color:red; padding:20px;">Error loading PDF. Please try again.</div>';
    }
}
