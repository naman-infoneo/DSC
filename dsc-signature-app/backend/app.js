const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');
const signer = require('node-signpdf').default;
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());

// async function addVisibleSignatureField(pdfBuffer) {
//   const pdfDoc = await PDFDocument.load(pdfBuffer);
//   const pages = pdfDoc.getPages();
//   const firstPage = pages[0];
  
//   // Get page dimensions
//   const { width, height } = firstPage.getSize();
  
//   // Define signature position (bottom-right corner)
//   const sigX = 50;
//   const sigY = 50;
//   const sigWidth = 200;
//   const sigHeight = 100;

//   // Add visible text/drawing to make signature more visible
//   const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
//   // Draw signature box background
//   firstPage.drawRectangle({
//     x: sigX,
//     y: sigY,
//     width: sigWidth,
//     height: sigHeight,
//     borderColor: rgb(0, 0, 0),
//     borderWidth: 1,
//   });

//   // Add signature text
//   firstPage.drawText('Digitally Signed By:', {
//     x: sigX + 5,
//     y: sigY + sigHeight - 20,
//     size: 10,
//     font: font,
//     color: rgb(0, 0, 0),
//   });

//   firstPage.drawText('Your Name', {
//     x: sigX + 5,
//     y: sigY + sigHeight - 35,
//     size: 12,
//     font: font,
//     color: rgb(0, 0, 0),
//   });

//   firstPage.drawText('Date: ' + new Date().toLocaleDateString(), {
//     x: sigX + 5,
//     y: sigY + sigHeight - 50,
//     size: 8,
//     font: font,
//     color: rgb(0, 0, 0),
//   });

//   // Add the signature placeholder
//   pdflibAddPlaceholder({
//     pdfDoc,
//     reason: 'Document approval',
//     location: 'India',
//     name: 'Your Name',
//     contactInfo: 'support@yourcompany.com',
//     signatureLength: 4000,
//     widgetRect: [sigX, sigY, sigX + sigWidth, sigY + sigHeight],
//     signingTime: new Date(),
//   });

//   const pdfBytes = await pdfDoc.save({ 
//     useObjectStreams: false,
//     updateFieldAppearances: true 
//   });
//   return Buffer.from(pdfBytes);
// }

async function addVisibleSignatureField(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const allPage = pdfDoc.getPages();
  const firstPage = allPage[allPage.length - 1];
  
  // Create visible signature appearance first
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const sigX = 400;  // Right side of page
  const sigY = 30;  // Bottom area
  const sigWidth = 160;
  const sigHeight = 70;

  // Draw signature box
  firstPage.drawRectangle({
    x: sigX,
    y: sigY,
    width: sigWidth,
    height: sigHeight,
    borderColor: rgb(0, 0, 0),
    // borderWidth: 0,
    // color: rgb(0.95, 0.95, 0.95), // Light gray background
  });

  // Add "DIGITALLY SIGNED" text
  firstPage.drawText('DIGITALLY SIGNED', {
    x: sigX + 10,
    y: sigY + 50,
    size: 12,
    font: font,
    color: rgb(0, 0.5, 0), // Green color
    opacity: 0.6,
  });

  firstPage.drawText('Your Name', {
    x: sigX + 10,
    y: sigY + 30,
    size: 10,
    font: font,
    color: rgb(0, 0, 0),
    opacity: 0.6,
  });

  firstPage.drawText(new Date().toLocaleString(), {
    x: sigX + 10,
    y: sigY + 10,
    size: 8,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
    opacity: 0.6,
  });

  // Then add the cryptographic signature
  pdflibAddPlaceholder({
    pdfDoc,
    reason: 'Document approval',
    location: 'India',
    name: 'Your Name',
    contactInfo: 'support@yourcompany.com',
    signatureLength: 40000000,
    widgetRect: [sigX, sigY, sigX + sigWidth, sigY + sigHeight],
    signingTime: new Date(),
  });

  return Buffer.from(await pdfDoc.save({ 
    useObjectStreams: false,
    updateFieldAppearances: true 
  }));
}


app.post('/sign', upload.single('pdf'), async (req, res) => {
  try {
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfWithPlaceholder = await addVisibleSignatureField(pdfBuffer);
    const p12Buffer = fs.readFileSync('./sharad.pfx');
    
    const signedPdf = signer.sign(pdfWithPlaceholder, p12Buffer, {
      passphrase: 'emudhra',
    });

    fs.unlinkSync(req.file.path);

    res.type('application/pdf');
    res.send(Buffer.from(signedPdf));
  } catch (err) {
    console.error('Signing error:', err);
    res.status(500).send('Signing error: ' + err.message);
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
