// backend/app.js
const express = require('express');
const multer = require('multer');
const signer = require('node-signpdf').default;
const plainAddPlaceholder = require('node-signpdf/dist/helpers/plainAddPlaceholder').default;
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());

async function addVisibleSignatureField(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];

  // Draw a rectangle for signature block
  firstPage.drawRectangle({
    x: 50,
    y: 50,
    width: 200,
    height: 70,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
    color: rgb(0.9, 0.9, 0.9),
  });

  // Add text inside the block
  firstPage.drawText('Digitally Signed by:\nYour Name', {
    x: 55,
    y: 95,
    size: 10,
    color: rgb(0, 0, 0),
  });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });

  // Add signature placeholder for node-signpdf
  return plainAddPlaceholder({
    pdfBuffer: Buffer.from(pdfBytes),
    reason: 'Document approval',
    location: 'India',
    name: 'Your Name',
    contactInfo: 'support@yourcompany.com',
    signatureLength: 1612,
  });
}


app.post('/sign', upload.single('pdf'), async (req, res) => {
  try {
    // Read uploaded PDF file
    const pdfBuffer = fs.readFileSync(req.file.path);

    // Add a visible signature placeholder (green tick block)
    const pdfWithPlaceholder = await addVisibleSignatureField(pdfBuffer);

    // Load your DSC certificate
    const p12Buffer = fs.readFileSync('./certificate.pfx');

    // Digitally sign the PDF
    const signedPdf = signer.sign(pdfWithPlaceholder, p12Buffer, {
      passphrase: '123456',
    });

    // Clean up
    fs.unlinkSync(req.file.path);

    // Return the signed PDF
    res.type('application/pdf');
    res.send(Buffer.from(signedPdf));
  } catch (err) {
    console.error('Signing error:', err);
    res.status(500).send('Signing error: ' + err.message);
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
