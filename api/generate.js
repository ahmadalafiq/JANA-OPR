// /api/generate.js
// Fungsi Serverless Vercel — bertindak sebagai proksi selamat antara frontend
// (index.html) dengan Gemini API. API key Gemini disimpan sebagai Environment
// Variable di Vercel (GEMINI_API_KEY) dan TIDAK PERNAH terdedah kepada browser.
//
// CARA SETUP DI VERCEL:
// 1. Letak fail ini di dalam repo GitHub anda pada path: /api/generate.js
//    (folder /api di root repo — Vercel akan mengesannya secara automatik)
// 2. Dapatkan API key percuma di https://aistudio.google.com/apikey
// 3. Di Vercel: Project Settings -> Environment Variables
//    Nama: GEMINI_API_KEY
//    Nilai: (API key anda)
// 4. Redeploy project. Butang "Jana AI" dalam index.html akan berfungsi selepas ini.

const BULAN_MODEL = 'gemini-3.6-flash';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Kaedah tidak dibenarkan. Guna POST.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: 'GEMINI_API_KEY belum ditetapkan di server. Sila tambah dalam Vercel Project Settings > Environment Variables.',
        });
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    const { section, context } = body || {};

    if (!section || !context) {
        return res.status(400).json({ error: 'Data tidak lengkap. Perlukan "section" dan "context".' });
    }

    const konteksTeks = [
        `Nama Program: ${context.namaProgram || '-'}`,
        `Tarikh: ${context.tarikh || '-'}`,
        `Tempat: ${context.tempat || '-'}`,
        `Anjuran: ${context.anjuran || '-'}`,
        `Kumpulan Sasaran: ${context.sasaran || '-'}`,
        `Kehadiran: ${context.kehadiran || '-'}`,
    ].join('\n');

    let prompt;
    let schema;

    if (section === 'objektif') {
        prompt = `Anda seorang pegawai Pejabat Pendidikan Daerah (PPD) di Malaysia yang menyediakan One Page Report (OPR) rasmi.
Berdasarkan maklumat program di bawah, jana 3 hingga 4 objektif program dalam Bahasa Melayu formal, ringkas dan padat (tidak lebih 25 patah perkataan setiap satu). Setiap objektif mesti bermula dengan kata kerja transitif seperti "Meningkatkan", "Memantapkan", "Memberi", "Melahirkan", "Mewujudkan".

${konteksTeks}`;
        schema = {
            type: 'OBJECT',
            properties: {
                items: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['items'],
        };
    } else if (section === 'implementasi') {
        prompt = `Anda seorang pegawai Pejabat Pendidikan Daerah (PPD) di Malaysia yang menyediakan One Page Report (OPR) rasmi.
Berdasarkan maklumat program di bawah, jana 3 hingga 4 butiran ringkasan perjalanan/implementasi program secara kronologi (dari permulaan hingga penutup), dalam Bahasa Melayu formal, ringkas dan padat (tidak lebih 25 patah perkataan setiap satu).

${konteksTeks}`;
        schema = {
            type: 'OBJECT',
            properties: {
                items: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['items'],
        };
    } else if (section === 'impak') {
        prompt = `Anda seorang pegawai Pejabat Pendidikan Daerah (PPD) di Malaysia yang menyediakan One Page Report (OPR) rasmi.
Berdasarkan maklumat program di bawah, jana analisis SWOC (Kekuatan, Kelemahan, Peluang, Cabaran) untuk pelaksanaan program ini. Berikan 2 hingga 3 butiran bagi setiap kategori, dalam Bahasa Melayu formal, ringkas dan padat (tidak lebih 20 patah perkataan setiap satu).

${konteksTeks}`;
        schema = {
            type: 'OBJECT',
            properties: {
                kekuatan: { type: 'ARRAY', items: { type: 'STRING' } },
                kelemahan: { type: 'ARRAY', items: { type: 'STRING' } },
                peluang: { type: 'ARRAY', items: { type: 'STRING' } },
                cabaran: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['kekuatan', 'kelemahan', 'peluang', 'cabaran'],
        };
    } else {
        return res.status(400).json({ error: `Jenis seksyen tidak sah: "${section}".` });
    }

    try {
        const { status, ok, data, errText } = await callGeminiWithRetry(prompt, schema, apiKey);

        if (!ok) {
            // Beza mesej ikut jenis ralat supaya senang didiagnosis di sisi pengguna.
            let userMsg = 'Ralat semasa menghubungi Gemini API. Sila semak API key atau kuota.';
            if (status === 429) userMsg = 'Had kadar (rate limit) Gemini API tercapai. Sila tunggu seketika dan cuba lagi.';
            else if (status === 400 || status === 403) userMsg = 'API key tidak sah atau tiada kebenaran. Sila semak GEMINI_API_KEY di Vercel.';
            else if (status === 503) userMsg = 'Pelayan Gemini sedang sibuk (overloaded). Sila cuba lagi sebentar lagi.';
            else if (status === 404) userMsg = `Model AI "${BULAN_MODEL}" tidak lagi tersedia. Sila kemaskini pemalar BULAN_MODEL dalam api/generate.js kepada model terkini yang disyorkan Google.`;
            console.error('Gemini API error (selepas cuba semula):', status, errText);
            return res.status(502).json({ error: userMsg });
        }

        const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textOut) {
            console.error('Respons Gemini tidak dijangka:', JSON.stringify(data));
            return res.status(502).json({ error: 'Tiada kandungan dipulangkan oleh Gemini.' });
        }

        let parsed;
        try {
            parsed = JSON.parse(textOut);
        } catch (parseErr) {
            console.error('Gagal parse JSON daripada Gemini:', textOut);
            return res.status(502).json({ error: 'Format respons daripada Gemini tidak sah.' });
        }

        return res.status(200).json(parsed);
    } catch (err) {
        console.error('Ralat pelayan:', err);
        return res.status(500).json({ error: 'Ralat pelayan semasa menjana kandungan. Sila cuba lagi.' });
    }
}

// Panggil Gemini dengan cuba-semula automatik untuk ralat sementara (429 / 503).
// Ralat 400/403 (API key tak sah) tidak diulang kerana pasti akan gagal lagi.
async function callGeminiWithRetry(prompt, schema, apiKey, maxRetries = 2) {
    let lastStatus = 0;
    let lastErrText = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${BULAN_MODEL}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: schema,
                        temperature: 0.7,
                    },
                }),
            }
        );

        if (geminiRes.ok) {
            return { ok: true, status: geminiRes.status, data: await geminiRes.json() };
        }

        lastStatus = geminiRes.status;
        lastErrText = await geminiRes.text();

        const isRetryable = lastStatus === 429 || lastStatus === 503;
        if (!isRetryable || attempt === maxRetries) {
            return { ok: false, status: lastStatus, errText: lastErrText };
        }

        // Backoff ringkas sebelum cuba semula: 500ms, 1000ms, ...
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }

    return { ok: false, status: lastStatus, errText: lastErrText };
}
