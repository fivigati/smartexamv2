/* =====================================================
   GLOBAL CONFIG & STATE
   ===================================================== */
window.correctToken = "";
window.examLink = "";
window.currentZoom = 100;
window.timerInterval = null;
window.isExamActive = false;
window.isForceClosing = false;
window.isOffline = false;
window.lastViolationTime = 0;
window.violationCooldown = 3000;

window.sessionData = {
    npsn: "",
    nisn: "",
    exam_id: "",
    exit_token: "",
    userIP: "0.0.0.0",
    wakeLock: null,
    minExitMinutes: 10,
    max_violation: "UNLIMITED",
    auto_kick_enabled: false,
    allow_multi_device: true,
    heartbeat_enabled: false
};

const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

// JEMBATAN PRODUCTION: DENGAN FITUR RETRY OTOMATIS (MENGATASI COLD START GAS)
async function eksekusiGAS(payload, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(CONFIG.SCRIPT_URL, {
                method: "POST",
                mode: "cors",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (err) {
            console.warn(`Percobaan ke-${i + 1} gagal:`, err);
            if (i < retries - 1) {
                // Tunggu beberapa detik sebelum mencoba lagi (mencegah server shock)
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error("API Connection Error Final:", err);
                throw new Error("Gagal berkomunikasi dengan server ujian.");
            }
        }
    }
}

/* =====================================================
   INITIALIZATION & NETWORKSTATE
   ===================================================== */
window.onload = () => {
    const savedId = localStorage.getItem('smartExam_id');
    if (savedId) {
        document.getElementById('studentId').value = savedId;
        document.getElementById('rememberId').checked = true;
    }
    fetchIP();
};

async function fetchIP() {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        sessionData.userIP = data.ip;
    } catch (e) { console.log("Gagal ambil IP"); }
}

window.addEventListener('offline', () => {
    window.isOffline = true;
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.classList.remove('hidden');
});

window.addEventListener('online', () => {
    window.isOffline = false;
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.classList.add('hidden');
    showNotif('Koneksi kembali normal', 'success');
});

/* =====================================================
   NOTIFICATION SYSTEM
   ===================================================== */
function showNotif(msg, type = 'info') {
    const n = document.getElementById('notification');
    const c = document.getElementById('notif-color');
    const i = document.getElementById('notif-icon');
    document.getElementById('notif-message').innerText = msg;

    c.className = `w-10 h-10 rounded-full flex items-center justify-center mr-3 ${type === 'error' ? 'bg-rose-500' : 'bg-emerald-500'}`;
    i.className = `fas ${type === 'error' ? 'fa-times' : 'fa-circle-check'}`;
    n.style.transform = 'translateY(0) translateX(-50%)';

    setTimeout(() => {
        n.style.transform = 'translateY(-250%) translateX(-50%)';
    }, 3000);
}

/* =====================================================
   AUTHENTICATION LOGIC
   ===================================================== */
async function handleLogin(e) {
    e.preventDefault();
    const id = document.getElementById('studentId').value;
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Memverifikasi...';
    
    try {
        const r = await eksekusiGAS({ action: 'verifyStudent', nisn: id });
        if(r.success) {
            const remember = document.getElementById('rememberId').checked;
            if (remember) {
                localStorage.setItem('smartExam_id', id);
            } else {
                localStorage.removeItem('smartExam_id');
            }
            
            sessionData.nisn = id;
            sessionData.npsn = r.student.school_npsn;
            sessionData.exam_id = r.exam.exam_id || r.exam.subject; 
            sessionData.exit_token = r.exam.exit || r.exam.exit_token || "";
            
            sessionData.minExitMinutes = r.config.min_exit_minutes;
            sessionData.max_violation = r.config.max_violation;
            sessionData.auto_kick_enabled = r.config.auto_kick_enabled;
            sessionData.allow_multi_device = r.config.allow_multi_device;
            sessionData.heartbeat_enabled = r.config.heartbeat_enabled;

            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('studentSection').classList.remove('hidden');
            document.getElementById('studentName').innerText = r.student.full_name;
            document.getElementById('studentClass').innerText = r.student.class_name;
            document.getElementById('studentSchool').innerText = r.school.school_name;
            document.getElementById('studentSection').dataset.duration = r.exam.duration || 90;
            renderExam(r.exam);
            showNotif('Identitas terverifikasi', 'success');
        } else {
            showNotif(r.message || 'ID tidak ditemukan', 'error');
        }
    } catch (err) { 
        showNotif('Gagal terhubung ke server ujian', 'error'); 
        console.error(err);
    } finally { 
        btn.disabled = false; 
        btn.innerHTML = 'Verifikasi ID'; 
    }
}

function renderExam(exam) {
    const container = document.getElementById('examContainer');
    if(exam && exam.status === 'ACTIVE') {
        correctToken = (exam.token || "").toString().trim();
        examLink = exam.link;
        container.innerHTML = `
            <div class="bg-white rounded-[2rem] shadow-sm p-5 border border-slate-100 fade-in text-center">
                <div class="inline-flex items-center gap-2 bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-[9px] font-black mb-4 border border-emerald-100 uppercase tracking-widest">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Ujian Aktif
                </div>
                <h3 class="text-sm font-extrabold text-slate-800 mb-1">${exam.subject}</h3>
                <div class="flex justify-center gap-3 text-[10px] font-bold text-slate-400 mb-5">
                    <span><i class="far fa-clock mr-1 text-indigo-400"></i> ${exam.start_time} - ${exam.end_time}</span>
                    <span><i class="fas fa-hourglass-half mr-1 text-indigo-400"></i> ${exam.duration || 0} Menit</span>
                </div>
                <div class="mb-4 text-left">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1 tracking-widest">Token Ujian</label>
                    <input type="text" id="tokenInput" placeholder="••••••" class="block w-full px-4 py-3 text-center text-lg tracking-[0.3em] text-indigo-600 rounded-2xl font-black uppercase bg-[#F8FAFF] border border-[#EDF2FF] focus:bg-white focus:border-indigo-500 outline-none transition-all">
                </div>
                <button onclick="startExam()" class="btn-gradient w-full py-3.5 text-white font-bold rounded-2xl text-sm">Mulai Ujian</button>
            </div>`;
    } else {
        container.innerHTML = `<div class="bg-slate-50/50 border border-dashed border-slate-200 rounded-[2rem] p-8 text-center fade-in"><i class="fas fa-calendar-times text-slate-200 text-3xl mb-3"></i><div class="text-xs font-bold text-slate-400 uppercase tracking-widest">Tidak Ada Jadwal Aktif</div></div>`;
    }
}

/* =====================================================
   EXAM RUNTIME CONTROLLER
   ===================================================== */
function startExam() {
    const input = document.getElementById('tokenInput').value.toUpperCase().trim();
    if (input === correctToken.toUpperCase()) {
        showNotif('Token valid! Membuka soal...', 'success');

        setTimeout(async () => {
            const duration = parseInt(document.getElementById('studentSection').dataset.duration);
            document.getElementById('examWrapper').classList.replace('hidden', 'flex');
            document.getElementById('examIframe').src = examLink;

            isExamActive = true;
            await enterFullscreen();
            aktifkanWakeLock();

            if (sessionData.heartbeat_enabled) {
                startHeartbeat();
            } else {
                kirimHeartbeat({
                    action: 'recordHeartbeat',
                    npsn: sessionData.npsn,
                    nisn: sessionData.nisn,
                    exam_id: sessionData.exam_id,
                    session_status: 'ONLINE',
                    fullscreen_status: 'FULL',
                    browser_info: navigator.userAgent,
                    device_info: `${navigator.platform} | ${navigator.vendor}`,
                    ip_address: sessionData.userIP
                });
            }
            startTimer(duration * 60);
        }, 1000);
    } else {
        showNotif('Token ujian salah!', 'error');
    }
}

function startTimer(seconds) {
    clearInterval(timerInterval);
    let timeRemaining = seconds;
    const display = document.getElementById('examTimer');

    timerInterval = setInterval(() => {
        let h = Math.floor(timeRemaining / 3600);
        let m = Math.floor((timeRemaining % 3600) / 60);
        let s = timeRemaining % 60;

        display.innerText = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        const remainingMinutes = timeRemaining / 60;
        const closeBtn = document.getElementById('btnCloseExam');

        if (closeBtn) {
            if (sessionData.minExitMinutes === 0 || remainingMinutes <= sessionData.minExitMinutes) {
                closeBtn.disabled = false;
                closeBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                closeBtn.classList.add('hover:bg-indigo-700', 'active:scale-95'); 
            } else {
                closeBtn.disabled = true;
                closeBtn.classList.add('opacity-50', 'cursor-not-allowed');
                closeBtn.classList.remove('hover:bg-indigo-700', 'active:scale-95');
            }
        }

        if (timeRemaining-- <= 0) {
            clearInterval(timerInterval);
            tampilkanModalWaktuHabis();
        }
    }, 1000);
}

function zoomExam(type) {
    const iframe = document.getElementById('examIframe');
    if (type === 'in' && currentZoom < 150) currentZoom += 10;
    else if (type === 'out' && currentZoom > 70) currentZoom -= 10;
    const scale = currentZoom / 100;
    iframe.style.transform = `scale(${scale})`;
    iframe.style.width = (100 / scale) + "%";
    iframe.style.height = (100 / scale) + "%";
}

function refreshExam() {
    const iframe = document.getElementById('examIframe');
    const url = iframe.src;
    iframe.src = '';
    setTimeout(() => { iframe.src = url; }, 50);
}

// Manajemen audio
function stopAlarm() {
    const audio = document.getElementById('alarmAudio');
    if(audio) {
        audio.pause();
        audio.currentTime = 0;
    }
}

function tampilkanModalWaktuHabis() {
    let countdown = 5;
    document.getElementById('timeUpModal').classList.replace('hidden', 'flex');
    const countdownText = document.getElementById('timeUpCountdown');
    countdownText.innerText = countdown;

    const interval = setInterval(() => {
        countdown--;
        countdownText.innerText = countdown;
        if (countdown <= 0) {
            clearInterval(interval);
            document.getElementById('timeUpModal').classList.replace('flex', 'hidden');
            resetExamSession();
        }
    }, 1000);
}

/* =====================================================
   HEARTBEAT CORE SCRIPT
   ===================================================== */
async function kirimHeartbeat(payload) {
    try {
        const res = await eksekusiGAS(payload);
       console.log("Respon Server:", res);
        if (window.isForceClosing) return;

        // 1. JIKA SERVER MENJAWAB SESI TIDAK VALID/TERHAPUS 
        // (Misalnya: Admin menekan Reset, Multi-Device, atau Sesi hilang dari database)
        if (!res.success) {
            // Hentikan semua interval dan bersihkan layar ujian
            if (sessionData.heartbeatInterval) clearInterval(sessionData.heartbeatInterval);
            if (timerInterval) clearInterval(timerInterval);
            isExamActive = false;
            document.getElementById('examIframe').src = "about:blank"; 
            
            let judulNotif = "Akses Ditolak";
            let subJudulNotif = "Terjadi kendala pada sesi ujian Anda.";
            let iconNotif = "fa-triangle-exclamation";
            let pesanDariServer = res.message ? res.message.toLowerCase() : "";

            // Deteksi pesan dari backend untuk menentukan notifikasi yang tepat
            if (pesanDariServer.includes('perangkat lain') || pesanDariServer.includes('multi')) {
                judulNotif = "Akses Ditolak";
                subJudulNotif = "Akun terdeteksi aktif di perangkat lain.";
                iconNotif = "fa-mobile-screen";
            } 
            else if (pesanDariServer.includes('tidak ditemukan') || pesanDariServer.includes('reset') || pesanDariServer.includes('tidak valid')) {
                judulNotif = "Sesi Direset";
                subJudulNotif = "Sesi ujian Anda telah direset oleh Admin/Proktor.";
                iconNotif = "fa-user-shield";
            }

            // Tampilkan modal sesuai kategori
            showSecurityModal({
                title: judulNotif,
                subtitle: subJudulNotif,
                message: res.message || "Sesi ujian ditutup oleh sistem.",
                icon: iconNotif
            });
            return; // Berhenti di sini agar tidak memproses logic selanjutnya
        }
       
        if (res.kicked) {
            if (sessionData.heartbeatInterval) clearInterval(sessionData.heartbeatInterval);
            if (timerInterval) clearInterval(timerInterval);
            isExamActive = false;
            document.getElementById('examIframe').src = "about:blank";
            
            showSecurityModal({
                title: "Ujian Dihentikan",
                subtitle: "Batas pelanggaran telah tercapai.",
                message: "Akun ujian Anda dinonaktifkan sementara oleh sistem.",
                icon: "fa-ban"
            });
           return; // Berhenti di sini agar tidak memproses logic selanjutnya
        }
       if (res.new_link && typeof currentExamLink !== 'undefined' && res.new_link !== currentExamLink) {
          currentExamLink = res.new_link;
          document.getElementById('examIframe').src = currentExamLink;
          console.log("Link ujian diperbarui oleh Admin."); 
       }

    } catch (err) {
        console.log('Heartbeat Error:', err);
    }
}

function startHeartbeat() {
    kirimHeartbeat({
        action: 'recordHeartbeat',
        npsn: sessionData.npsn,
        nisn: sessionData.nisn,
        exam_id: sessionData.exam_id,
        session_status: 'ONLINE',
        fullscreen_status: 'FULL',
        browser_info: navigator.userAgent,
        device_info: `${navigator.platform} | ${navigator.vendor}`,
        ip_address: sessionData.userIP
    });

    sessionData.heartbeatInterval = setInterval(() => {
        if (!isExamActive) return;
        if (!sessionData.heartbeat_enabled) {
            clearInterval(sessionData.heartbeatInterval);
            return;
        }

        const isVisible = !document.hidden;
        const isFullscreen = !!document.fullscreenElement || !!document.webkitFullscreenElement;

        let st = "ONLINE";
        if (!isVisible || (!isIOS && !isFullscreen)) st = "AWAY";

        kirimHeartbeat({
            action: 'recordHeartbeat',
            npsn: sessionData.npsn,
            nisn: sessionData.nisn,
            exam_id: sessionData.exam_id,
            session_status: st,
            fullscreen_status: isFullscreen ? 'FULL' : 'WINDOWED',
            browser_info: navigator.userAgent,
            device_info: `${navigator.platform} | ${navigator.vendor}`,
            ip_address: sessionData.userIP
        });
    }, 15000);
}

/* =====================================================
   WAKELOCK & FULLSCREEN LOGIC
   ===================================================== */
async function aktifkanWakeLock() {
    if ('wakeLock' in navigator) {
        try { sessionData.wakeLock = await navigator.wakeLock.request('screen'); } 
        catch (err) { console.log("WakeLock gagal:", err); }
    }
}

document.addEventListener("visibilitychange", async () => {
    if (sessionData.wakeLock !== null && document.visibilityState === "visible") {
        try { sessionData.wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {}
    }
});

async function enterFullscreen() {
    try {
        const el = document.documentElement;
        if (el.requestFullscreen) { await el.requestFullscreen(); } 
        else if (el.webkitRequestFullscreen) { await el.webkitRequestFullscreen(); }
        return true;
    } catch (err) { return false; }
}

document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) { aktifkanWakeLock(); }
});

/* =====================================================
   SECURITY MONITORING LOGIC (VERSI ADIL & ANTI-FALSE ALARM iOS)
   ===================================================== */
let iosViolationTimeout = null;

document.addEventListener("visibilitychange", () => {
    if (isExamActive && document.hidden && document.visibilityState === "hidden") {
        triggerViolation("PINDAH TAB");
    } else if (!document.hidden) {
        stopAlarm();
    }
});

document.addEventListener("fullscreenchange", () => {
    setTimeout(() => {
        if (isExamActive && !window.isForceClosing && !document.fullscreenElement && !isIOS && document.visibilityState === "visible") {
            triggerViolation("KELUAR FULLSCREEN");
            document.getElementById('lockScreen').classList.remove('hidden');
            document.getElementById('lockScreen').classList.add('flex');
        }
    }, 300);
});

if (isIOS) {

    // iOS Safari terlalu sensitif terhadap blur
    // jadi blur diabaikan total

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            handleIosBlurAction();
        } else {
            stopAlarm();

            if (iosViolationTimeout) {
                clearTimeout(iosViolationTimeout);
                iosViolationTimeout = null;
            }
        }
    });

    window.addEventListener("pagehide", () => {
        handleIosBlurAction();
    });

    window.addEventListener("focus", () => {
        if (isExamActive) {
            stopAlarm();

            if (iosViolationTimeout) {
                clearTimeout(iosViolationTimeout);
                iosViolationTimeout = null;
            }
        }
    });
}

function handleIosBlurAction() {
    if (!isExamActive || window.isForceClosing) return;

    document.getElementById('alarmAudio').play();

    document.getElementById('lockScreen').classList.remove('hidden');
    document.getElementById('lockScreen').classList.add('flex');

    if (!iosViolationTimeout) {
        iosViolationTimeout = setTimeout(() => {
            triggerViolation("PINDAH TAB / MINIMIZE (iOS)");
            iosViolationTimeout = null;
        }, 8000);
    }
}

async function triggerViolation(type) {
    const now = Date.now();
    if (now - lastViolationTime < violationCooldown) return;
    lastViolationTime = now;

    const audio = document.getElementById('alarmAudio');
    if(audio) audio.play();

    try {
        const res = await eksekusiGAS({
            action: 'logViolation',
            npsn: sessionData.npsn,
            nisn: sessionData.nisn,
            exam_id: sessionData.exam_id,
            type: type,
            device_info: isIOS ? `${navigator.platform} | iOS Device` : `${navigator.platform} | ${navigator.vendor}`,
            ip_address: sessionData.userIP
        });
        if (res.kicked) {
            showSecurityModal({
                title: "Ujian Dihentikan",
                subtitle: "Batas pelanggaran telah tercapai.",
                message: "Akun ujian Anda dinonaktifkan sementara oleh sistem.",
                icon: "fa-ban"
            });
        }
    } catch (e) { console.log(e); }
}

async function kembaliKeFullscreen() {
    const success = await enterFullscreen();
    if (success || isIOS) {
        aktifkanWakeLock();
        document.getElementById('lockScreen').classList.add('hidden');
        document.getElementById('lockScreen').classList.remove('flex');
        stopAlarm();
        if (iosViolationTimeout) {
            clearTimeout(iosViolationTimeout);
            iosViolationTimeout = null;
        }
    }
}

function showSecurityModal({title = "Keamanan Sistem", subtitle = "Aktivitas tidak valid.", message = "Sesi ujian ditutup.", icon = "fa-shield-halved"}) {
    if (window.isForceClosing) return;
    window.isForceClosing = true;

    document.getElementById('securityModalIcon').className = `fas ${icon} text-white text-4xl`;
    document.getElementById('securityModalTitle').innerText = title;
    document.getElementById('securityModalSubtitle').innerText = subtitle;
    document.getElementById('securityModalMessage').innerText = message;

    const modal = document.getElementById('securityModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    setTimeout(() => {
        resetExamSession();
        modal.classList.remove('flex');
        modal.classList.add('hidden');
        window.isForceClosing = false;
    }, 5000);
}

/* =====================================================
   EXIT MODAL & RESET SYSTEM
   ===================================================== */
function closeExam() {
    document.getElementById('modalExit').classList.replace('hidden', 'flex');
    document.getElementById('exitTokenInput').value = "";
    document.getElementById('exitErrorMsg').classList.add('hidden');
    setTimeout(() => document.getElementById('exitTokenInput').focus(), 300);
}

function tutupModalExit() {
    document.getElementById('modalExit').classList.replace('flex', 'hidden');
    document.getElementById('stepToken').classList.add('hidden');
    document.getElementById('stepConfirmation').classList.remove('hidden');
    
    // --- TAMBAHAN: BERSIHKAN STATUS TOMBOL ---
    const btnExit = document.getElementById('btnFinalExit');
    if (btnExit) {
        btnExit.disabled = false;
        btnExit.innerHTML = 'KELUAR'; // Kembalikan teks asli
    }
    
    const btnSubmit = document.getElementById('btnCloseExam');
    if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = 'SAYA SUDAH SUBMIT';
    }
    // ----------------------------------------

    document.getElementById('exitTokenInput').value = "";
    document.getElementById('exitErrorMsg').classList.add('hidden');
}

function goToTokenStep(e) {
    if (e) { 
        e.preventDefault(); 
        e.stopPropagation(); 
    }
    const btn = document.getElementById('btnCloseExam');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> MEMPROSES...';
    }
    setTimeout(() => {
        document.getElementById('stepConfirmation').classList.add('hidden');
        document.getElementById('stepToken').classList.remove('hidden');
        const tokenInput = document.getElementById('exitTokenInput');
        if (tokenInput) { tokenInput.value = ""; tokenInput.focus(); }
        if (btn) { btn.innerHTML = 'SAYA SUDAH SUBMIT'; btn.disabled = false; }
    }, 200);
}

async function konfirmasiKeluar(e) {
    if (e) { 
        e.preventDefault(); 
        e.stopPropagation(); 
    }
    
    const inputUser = document.getElementById('exitTokenInput').value.trim().toUpperCase();
    const tokenSistem = String(sessionData.exit_token || "").trim().toUpperCase();
    
    // 1. BIDIK TOMBOL SECARA ABSOLUT MENGGUNAKAN ID (ANTI SALAH SASARAN)
    const btnExit = document.getElementById('btnFinalExit'); 
    const originalText = 'KELUAR';

    // 2. PROTEKSI AWAL: Jika kotak input masih kosong, hadang di tempat dan jangan biarkan loading!
    if (inputUser === "") {
        document.getElementById('exitErrorMsg').classList.remove('hidden');
        document.getElementById('exitTokenInput').focus();
        return; 
    }

    if (inputUser === tokenSistem && tokenSistem !== "") {
        if (btnExit) {
            btnExit.disabled = true;
            btnExit.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> KELUAR...';
        }
        try {
            await eksekusiGAS({
                action: 'recordHeartbeat',
                npsn: sessionData.npsn,
                nisn: sessionData.nisn,
                exam_id: sessionData.exam_id,
                session_status: 'DONE',
                fullscreen_status: 'FULL',
                browser_info: navigator.userAgent,
                device_info: `${navigator.platform} | ${navigator.vendor}`,
                ip_address: sessionData.userIP
            });
        } catch (err) { console.log("Gagal update status DONE, paksa reset."); }
        setTimeout(() => { resetExamSession(); }, 300);
    } else {
        document.getElementById('exitErrorMsg').classList.remove('hidden');
        const tokenInput = document.getElementById('exitTokenInput');
        if (tokenInput) { tokenInput.value = ""; tokenInput.focus(); }
        
        // 3. KEMBALIKAN TOMBOL KE STATUS SEMULA SECARA PAKSA TANPA SYARAT TAGNAME
        if (btnExit) { 
            btnExit.disabled = false; 
            btnExit.innerText = originalText; 
        }
    }
}

function resetExamSession() {
    isExamActive = false;
      window.isForceClosing = false;
    if (sessionData.heartbeatInterval) clearInterval(sessionData.heartbeatInterval);
    if (timerInterval) clearInterval(timerInterval);
    stopAlarm();

    if (sessionData.wakeLock) { sessionData.wakeLock.release().catch(() => {}); }
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }

    document.getElementById('examIframe').src = "about:blank";
    document.getElementById('examWrapper').classList.replace('flex', 'hidden');
    document.getElementById('studentSection').classList.add('hidden');
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('examTimer').innerText = "00:00:00";

    if (document.getElementById('tokenInput')) document.getElementById('tokenInput').value = "";
    if (document.getElementById('exitTokenInput')) document.getElementById('exitTokenInput').value = "";

    currentZoom = 100; correctToken = ""; examLink = ""; sessionData.exam_id = ""; sessionData.exit_token = "";
    tutupModalExit();

    const remember = document.getElementById('rememberId').checked;
    if (!remember) { localStorage.removeItem('smartExam_id'); document.getElementById('studentId').value = ""; }
}
