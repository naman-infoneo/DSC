// frontend/src/App.js
import React, { useState } from 'react';

function App() {
  const [pdf, setPdf] = useState(null);

  const handleChange = e => setPdf(e.target.files[0]);

  const handleSign = async () => {
    const formData = new FormData();
    formData.append('pdf', pdf);

    const res = await fetch('http://localhost:3001/sign', {
      method: 'POST',
      body: formData,
    });
    // Download signed file
    const blob = await res.blob();
    console.log('Signed PDF received:', blob);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'signed.pdf';
    a.click();
  };

  return (
    <div>
      <h1>DSC PDF Sign (Local Test)</h1>
      <input type="file" accept="application/pdf" onChange={handleChange} />
      <button onClick={handleSign} disabled={!pdf}>
        Sign PDF
      </button>
    </div>
  );
}

export default App;
