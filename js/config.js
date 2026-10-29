/* =====================================================
   SMART EXAM V2 - CONFIGURATION & SUPABASE CLIENT
   ===================================================== */

const CONFIG = {
    SUPABASE_URL: "https://oyuaksxmujrvlcbetond.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_fX8xLjPfqagwSbgs3UPbYQ_wljZ3Vb3"
};

// Inisialisasi Supabase Client (bisa menggunakan CDN supabase-js di index.html)
const { createClient } = supabase;
const db = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
