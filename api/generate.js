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
    const { context } = body || {};

    if (!context || !context.namaProgram) {
        return res.status(400).json({ error: 'Data tidak lengkap. Perlukan "context" dengan sekurang-kurangnya namaProgram.' });
    }

    const konteksTeks = [
        `Nama Program: ${context.namaProgram || '-'}`,
        `Keterangan Ringkas: ${context.keterangan || '-'}`,
        `Tarikh: ${context.tarikh || '-'}`,
        `Tempat: ${context.tempat || '-'}`,
        `Anjuran: ${context.anjuran || '-'}`,
        `Kumpulan Sasaran: ${context.sasaran || '-'}`,
        `Kehadiran: ${context.kehadiran || '-'}`,
    ].join('\n');

    // NOTA PENJAJARAN DENGAN index.html: medan Objektif & Implementasi di
    // borang (inp-obj-item / inp-imp-item) kini ada maxlength="160", dan
    // medan SWOT (inp-swoc-*-item) ada maxlength="100" — ini untuk elak
    // autoFitToPage() terpaksa kecilkan fon melampau bila teks terlalu
    // panjang. Had aksara di bawah (150 / 90) sengaja diberi jidar (buffer)
    // di bawah had sebenar borang supaya output AI tidak "tersekat" separuh
    // ayat bila tiba di medan input.
    const prompt = `Anda seorang pegawai Pejabat Pendidikan Daerah (PPD) di Malaysia yang menyediakan One Page Report (OPR) rasmi.
Berdasarkan maklumat program di bawah (terutamanya "Keterangan Ringkas" yang diberikan oleh pegawai), jana KETIGA-TIGA kandungan berikut sekaligus dalam Bahasa Melayu formal, ringkas dan padat:

1. "objektif" — 3 hingga 4 objektif program. Setiap objektif mesti bermula dengan kata kerja transitif seperti "Meningkatkan", "Memantapkan", "Memberi", "Melahirkan", "Mewujudkan". WAJIB tidak melebihi 150 aksara (termasuk ruang) setiap satu — kira aksara, bukan hanya perkataan, dan pendekkan ayat jika perlu supaya muat.

2. "implementasi" — 3 hingga 4 butiran ringkasan perjalanan/implementasi program secara kronologi (dari permulaan hingga penutup). WAJIB tidak melebihi 150 aksara (termasuk ruang) setiap satu.

3. "impak" — analisis SWOC (Kekuatan, Kelemahan, Peluang, Cabaran) untuk pelaksanaan program ini, dengan 2 hingga 3 butiran bagi setiap kategori (kekuatan, kelemahan, peluang, cabaran). WAJIB tidak melebihi 90 aksara (termasuk ruang) setiap satu — ayat mesti pendek dan padat.

Maklumat Program:
${konteksTeks}`;

    const schema = {
        type: 'OBJECT',
        properties: {
            objektif: { type: 'ARRAY', items: { type: 'STRING' } },
            implementasi: { type: 'ARRAY', items: { type: 'STRING' } },
            impak: {
                type: 'OBJECT',
                properties: {
                    kekuatan: { type: 'ARRAY', items: { type: 'STRING' } },
                    kelemahan: { type: 'ARRAY', items: { type: 'STRING' } },
                    peluang: { type: 'ARRAY', items: { type: 'STRING' } },
                    cabaran: { type: 'ARRAY', items: { type: 'STRING' } },
                },
                required: ['kekuatan', 'kelemahan', 'peluang', 'cabaran'],
            },
        },
        required: ['objektif', 'implementasi', 'impak'],
    };

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

        // Jaring keselamatan: pangkas paksa ke had aksara borang index.html
        // (obj/imp maxlength="160", swot maxlength="100") sekiranya Gemini
        // tidak patuh sepenuhnya kepada arahan panjang dalam prompt di atas.
        parsed.objektif = clampList(parsed.objektif, 155);
        parsed.implementasi = clampList(parsed.implementasi, 155);
        if (parsed.impak) {
            parsed.impak.kekuatan = clampList(parsed.impak.kekuatan, 95);
            parsed.impak.kelemahan = clampList(parsed.impak.kelemahan, 95);
            parsed.impak.peluang = clampList(parsed.impak.peluang, 95);
            parsed.impak.cabaran = clampList(parsed.impak.cabaran, 95);
        }

        return res.status(200).json(parsed);
    } catch (err) {
        console.error('Ralat pelayan:', err);
        return res.status(500).json({ error: 'Ralat pelayan semasa menjana kandungan. Sila cuba lagi.' });
    }
}

// Pangkas satu ayat ke had aksara maksimum tanpa memotong di tengah perkataan.
// Dipadankan dengan atribut maxlength di index.html supaya kandungan AI tidak
// pernah melebihi ruang medan input borang.
function clampText(str, maxLen) {
    if (typeof str !== 'string') return str;
    const trimmed = str.trim();
    if (trimmed.length <= maxLen) return trimmed;
    const cut = trimmed.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    const safe = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut;
    return safe.replace(/[.,;:\s]+$/, '');
}

function clampList(list, maxLen) {
    if (!Array.isArray(list)) return list;
    return list.map(item => clampText(item, maxLen));
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
