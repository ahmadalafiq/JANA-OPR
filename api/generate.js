// /api/generate.js
// Fungsi Serverless Vercel (Node.js) — dipanggil oleh app.js (generateWithAI())
// melalui POST /api/generate. Menjana Objektif, Ringkasan Implementasi dan
// Impak/SWOT untuk laporan OPR menggunakan Gemini API.
//
// PERSEDIAAN:
// 1. Tetapkan GEMINI_API_KEY sebagai Environment Variable dalam Vercel
//    (Project Settings -> Environment Variables). Dapatkan kunci di
//    https://aistudio.google.com/apikey
// 2. (Pilihan) GEMINI_MODEL — nama model Gemini yang hendak digunakan.
//    Default: "gemini-3.6-flash". Semak senarai model terkini di
//    https://ai.google.dev/gemini-api/docs/models sebelum deploy, kerana
//    nama/versi model boleh berubah dari semasa ke semasa.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Bentuk (shape) JSON yang MESTI dipulangkan oleh model — dipadankan terus
// dengan apa yang dijangka oleh generateWithAI() dalam app.js.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    objektif: { type: 'array', items: { type: 'string' } },
    implementasi: { type: 'array', items: { type: 'string' } },
    impak: {
      type: 'object',
      properties: {
        kekuatan: { type: 'array', items: { type: 'string' } },
        kelemahan: { type: 'array', items: { type: 'string' } },
        peluang: { type: 'array', items: { type: 'string' } },
        cabaran: { type: 'array', items: { type: 'string' } },
      },
      required: ['kekuatan', 'kelemahan', 'peluang', 'cabaran'],
    },
  },
  required: ['objektif', 'implementasi', 'impak'],
};

function buildPrompt(context) {
  const {
    namaProgram = '',
    keterangan = '',
    tarikh = '',
    tempat = '',
    anjuran = '',
    sasaran = '',
    kehadiran = '',
  } = context || {};

  return `Anda membantu seorang pegawai Pejabat Pendidikan Daerah (PPD) di Malaysia
menyediakan Laporan Satu Muka Surat (One Page Report / OPR) rasmi bagi sesuatu
program atau aktiviti. Tulis dalam Bahasa Melayu formal/rasmi sesuai untuk
dokumen kerajaan.

Maklumat Program:
- Nama Program: ${namaProgram || '(tiada)'}
- Keterangan Ringkas: ${keterangan || '(tiada)'}
- Tarikh: ${tarikh || '(tiada)'}
- Tempat: ${tempat || '(tiada)'}
- Anjuran: ${anjuran || '(tiada)'}
- Kumpulan Sasaran: ${sasaran || '(tiada)'}
- Kehadiran: ${kehadiran || '(tiada)'}

Jana kandungan berikut berdasarkan maklumat di atas:
1. "objektif": 3-4 objektif program, setiap satu SATU ayat penuh, ringkas dan
   padat (maksimum lebih kurang 15-18 patah perkataan setiap satu).
2. "implementasi": 3-5 butiran ringkasan pelaksanaan/aliran program secara
   kronologi (contoh: pendaftaran, ucapan aluan, sesi utama, penutup),
   setiap satu ringkas dan padat.
3. "impak": analisis SWOT ringkas dengan setiap kategori 2-3 butiran ringkas
   dan relevan dengan konteks program:
   - "kekuatan": kekuatan/strengths pelaksanaan program
   - "kelemahan": kelemahan/weaknesses yang dikenal pasti
   - "peluang": peluang/opportunities untuk penambahbaikan atau kesinambungan
   - "cabaran": cabaran/ancaman (threats) yang dihadapi

Elakkan ayat berjela, berulang, atau generik tanpa kaitan konteks program
yang diberikan. Jangan sertakan sebarang teks, penjelasan, markdown atau
tanda petik luar selain JSON itu sendiri.`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Kaedah tidak dibenarkan. Guna POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY belum ditetapkan pada pelayan. Sila tetapkan Environment Variable di Vercel.',
    });
  }

  let context;
  try {
    context = (req.body && req.body.context) || {};
  } catch (e) {
    return res.status(400).json({ error: 'Badan permintaan (request body) tidak sah.' });
  }

  if (!context.namaProgram) {
    return res.status(400).json({ error: 'Medan "namaProgram" diperlukan.' });
  }

  const prompt = buildPrompt(context);

  try {
    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text().catch(() => '');
      console.error('Gemini API error:', geminiRes.status, errBody);
      return res.status(502).json({
        error: `Gemini API memulangkan ralat (${geminiRes.status}). Sila semak GEMINI_API_KEY dan GEMINI_MODEL.`,
      });
    }

    const data = await geminiRes.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      console.error('Gemini response tanpa teks:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini tidak memulangkan sebarang kandungan yang boleh digunakan.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('Gagal parse JSON dari Gemini:', rawText);
      return res.status(502).json({ error: 'Gagal memproses respons AI (format JSON tidak sah).' });
    }

    return res.status(200).json({
      objektif: Array.isArray(parsed.objektif) ? parsed.objektif : [],
      implementasi: Array.isArray(parsed.implementasi) ? parsed.implementasi : [],
      impak: {
        kekuatan: Array.isArray(parsed.impak?.kekuatan) ? parsed.impak.kekuatan : [],
        kelemahan: Array.isArray(parsed.impak?.kelemahan) ? parsed.impak.kelemahan : [],
        peluang: Array.isArray(parsed.impak?.peluang) ? parsed.impak.peluang : [],
        cabaran: Array.isArray(parsed.impak?.cabaran) ? parsed.impak.cabaran : [],
      },
    });
  } catch (err) {
    console.error('Ralat semasa memanggil Gemini API:', err);
    return res.status(500).json({ error: 'Ralat pelayan dalaman semasa menjana kandungan AI.' });
  }
};
