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


async function addVisibleSignatureField(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];   // ✅ last page
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const sigX = 400;
  const sigY = 20;
  const sigWidth = 155;
  const sigHeight = 50;

  const PsigX = 398;
  const PsigY = 20;
  const PsigWidth = 159;
  const PsigHeight = 46;

  // Draw signature box
  lastPage.drawRectangle({
    x: sigX,
    y: sigY + 2,
    width: sigWidth,
    height: sigHeight - 8,
    borderColor: rgb(0.4, 0.4, 0.4),
    borderWidth: 0.5,
  });

  // ✅ embed checkmark
  const checkmarkBase64 = fs.readFileSync("./check.png");
  const checkImg = await pdfDoc.embedPng(checkmarkBase64);
  const imgSize = 35;
  lastPage.drawImage(checkImg, {
    x: sigX,
    y: sigY + (sigHeight / 2) - (imgSize / 2) - 2,
    width: imgSize,
    height: imgSize,

  });

  // ✅ add text
  const textX = sigX + 40;
  lastPage.drawText('Digitally signed on', {
    x: textX,
    y: sigY + sigHeight - 25,
    size: 9,
    font,
    color: rgb(0, 0, 0),

  });
  lastPage.drawText(new Date().toLocaleString(), {
    x: textX,
    y: sigY + 14,
    size: 8,
    font,
    color: rgb(0.4, 0.4, 0.4), //gray

  });

  pdflibAddPlaceholder({
    pdfDoc,
    reason: 'Document approval',
    location: 'India',
    name: 'Your Name',
    contactInfo: 'support@yourcompany.com',
    signatureLength: 40000,
    widgetRect: [PsigX, PsigY, PsigX + PsigWidth, PsigY + PsigHeight],
    // pdfPageRef: lastPage.ref,   // <-- key line
    // pdfPageIndex: lastPage,  // <-- key line
    pdfPage: lastPage,  // <-- key line
  });

  return Buffer.from(
    await pdfDoc.save({
      useObjectStreams: false,
      updateFieldAppearances: true,
    })
  );
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
