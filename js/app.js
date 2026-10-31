/* =====================================================
   SMART EXAM V2 - PRODUCTION BACKEND SUPABASE
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
    student_name: "",
    exam_id: "",
    exit_token: "",
    userIP: "0.0.0.0",
    wakeLock: null,
    minExitMinutes: 0,
    max_violation: "UNLIMITED",
    auto_kick_enabled: false,
    allow_multi_device: true,
    heartbeat_enabled: true
};

const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

/* =====================================================
   INITIALIZATION & NETWORK STATE
   ===================================================== */
window.onload = () => {
    const savedId = localStorage.getItem('smartExam_id');
    if (savedId) {
        document.getElementById('studentId').value = savedId;
        document.getElementById('rememberId').checked = true;
    }
    fetchIP();
    loadSchoolOptions(); // Memuat daftar sekolah dinamis dari Supabase
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
   AUTHENTICATION LOGIC (SUPABASE DIRECT)
   ===================================================== */
async function handleLogin(e) {
    e.preventDefault();
    const selectedNpsn = document.getElementById('selectedNpsnValue')?.value.trim() || "";
    const nisnInput = document.getElementById('studentId').value.trim();
    const btn = document.getElementById('submitBtn');

    if (!selectedNpsn) {
        showNotif('Silakan pilih nama sekolah yang valid!', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Memverifikasi...';
    
    try {
        // HANYA ambil kolom yang benar-benar dibutuhkan (Sangat ringan untuk RAM)
        const { data: student, error: studentError } = await db
            .from('students')
            .select('nisn, school_npsn, full_name, class_name, grade_level, account_status')
            .eq('nisn', nisnInput)
            .eq('school_npsn', selectedNpsn)
            .maybeSingle();

        if (studentError || !student) {
            showNotif('NISN tidak ditemukan pada sekolah tersebut', 'error');
            return;
        }

        if ((student.account_status || '').toUpperCase() === 'INACTIVE') {
            showNotif('Akun dinonaktifkan karena pelanggaran ujian', 'error');
            return;
        }

        // Simpan sesi lokal di browser (Mengurangi beban state server)
        sessionData.nisn = student.nisn;
        sessionData.student_name = student.full_name;
        sessionData.npsn = student.school_npsn;

         // Pindah UI
        document.getElementById('mainLoginCard').classList.add('hidden');
        document.getElementById('studentSection').classList.remove('hidden');
        document.getElementById('studentName').innerText = student.full_name;
        document.getElementById('studentClass').innerText = student.class_name;
        
        // Ambil teks nama sekolah dari input pencarian sekolah yang sedang aktif
        const schoolInputText = document.getElementById('schoolSearchInput')?.value.split('(')[0].trim() || "Sekolah";
        document.getElementById('studentSchool').innerText = schoolInputText;

        // Tarik jadwal ujian aktif secara spesifik berdasarkan npsn & kelas siswa
        await fetchAndRenderActiveExams(student);
        showNotif('Identitas terverifikasi', 'success');
    
    } catch (err) {
        showNotif('Gagal terhubung ke database ujian', 'error');
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi & Masuk Ujian';
    }
}

/* =====================================================
   MULTI-EXAM DASHBOARD RENDERER (DIPERBAIKI & BERSIH)
   ===================================================== */
async function fetchAndRenderActiveExams(student) {
    const container = document.getElementById('examContainer');
    if (!container) return;

    container.innerHTML = `<div class="p-3 text-center text-xs text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i> Memuat jadwal ujian...</div>`;

    try {
        // Ambil ujian aktif berdasarkan NPSN sekolah siswa
        const { data: exams, error } = await db
            .from('exams')
            .select('*')
            .eq('school_npsn', student.school_npsn)
            .eq('exam_status', 'ACTIVE');

        if (error) throw error;

        const studentClass = (student.class_name || "").toUpperCase().trim();
        const gradeLevel = (student.class_name || "").replace(/[^0-9]/g, '');

        let validExams = [];

        if (exams && exams.length > 0) {
            exams.forEach(exam => {
                const targets = (exam.target_class || "").toUpperCase().split(',').map(t => t.trim());
                const isAll = targets.includes('ALL');
                const isGradeMatch = targets.includes(gradeLevel);
                const isClassMatch = targets.includes(studentClass);

                if (isAll || isGradeMatch || isClassMatch) {
                    validExams.push(exam);
                }
            });
        }

        // Jika tidak ada jadwal ujian yang cocok
        if (validExams.length === 0) {
            container.innerHTML = `
                <div class="bg-white/40 backdrop-blur-md border border-white/60 rounded-2xl p-4 text-center">
                    <i class="fas fa-calendar-xmark text-purple-500 text-xl mb-1.5"></i>
                    <div class="text-xs font-bold text-slate-700">Belum Ada Jadwal Ujian Aktif</div>
                    <p class="text-[10px] text-slate-500 mt-0.5">Silakan tunggu hingga proktor membuka sesi ujian.</p>
                </div>`;
            return;
        }

        let htmlContent = '<div class="space-y-3 text-left">';
        validExams.forEach((exam) => {
            const startTimeStr = new Date(exam.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTimeStr = new Date(exam.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            htmlContent += `
                <div class="bg-white/60 backdrop-blur-md rounded-2xl p-3.5 border border-white/80 shadow-sm">
                    <div class="flex items-center justify-between mb-2">
                        <span class="inline-flex items-center gap-1.5 bg-emerald-500/10 text-emerald-700 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border border-emerald-500/20">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Tersedia
                        </span>
                        <span class="text-[10px] font-bold text-slate-500"><i class="far fa-clock mr-1 text-purple-500"></i> ${startTimeStr} - ${endTimeStr}</span>
                    </div>
                    <h4 class="text-xs font-extrabold text-slate-800 mb-2">${exam.subject} (${exam.duration_minutes} Menit)</h4>
                    <div class="space-y-2">
                        <input type="text" id="tokenInput_${exam.exam_id}" placeholder="MASUKKAN TOKEN" class="block w-full px-3 py-2 text-center text-xs tracking-[0.2em] text-purple-700 rounded-xl font-black uppercase bg-white/80 border border-white focus:bg-white focus:border-purple-500 outline-none transition-all">
                        <button onclick="selectAndStartExam(${exam.exam_id}, '${encodeURIComponent(exam.subject)}', '${exam.entry_token}', '${exam.exam_link}', ${exam.duration_minutes}, '${exam.exit_token || ""}')" class="w-full py-2 bg-gradient-to-r from-violet-600 to-pink-500 hover:opacity-95 text-white font-bold rounded-xl text-xs shadow-md shadow-purple-500/20 transition-all">
                            Mulai Ujian Ini
                        </button>
                    </div>
                </div>`;
        });
        htmlContent += '</div>';

        container.innerHTML = htmlContent;

    } catch (err) {
        console.error("Gagal memuat jadwal ujian:", err);
        container.innerHTML = `
            <div class="bg-white/40 backdrop-blur-md border border-white/60 rounded-2xl p-4 text-center">
                <i class="fas fa-triangle-exclamation text-rose-500 text-xl mb-1.5"></i>
                <div class="text-xs font-bold text-slate-700">Gagal Memuat Jadwal Ujian</div>
                <p class="text-[10px] text-slate-500 mt-0.5">Periksa koneksi database Anda.</p>
            </div>`;
    }
}
/* =====================================================
   EXAM RUNTIME CONTROLLER
   ===================================================== */
async function selectAndStartExam(examId, subjectEncoded, token, link, durationMinutes, exitToken) {
    const subject = decodeURIComponent(subjectEncoded);
    const tokenInput = document.getElementById(`tokenInput_${examId}`).value.toUpperCase().trim();

    if (tokenInput !== token.toUpperCase().trim()) {
        showNotif('Token ujian salah!', 'error');
        return;
    }

    sessionData.exam_id = subject;
    sessionData.exit_token = exitToken;
    document.getElementById('studentSection').dataset.duration = durationMinutes;
    examLink = link;

    showNotif('Token valid! Membuka soal...', 'success');

    setTimeout(async () => {
        document.getElementById('examWrapper').classList.replace('hidden', 'flex');
        document.getElementById('examIframe').src = examLink;

        isExamActive = true;
        await enterFullscreen();
        aktifkanWakeLock();

        await recordSessionToSupabase('ONLINE', 'FULL');

        if (sessionData.heartbeat_enabled) {
            startHeartbeat();
        }
        startTimer(durationMinutes * 60);
    }, 1000);
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
   HEARTBEAT & SESSION MANAGEMENT (SUPABASE UPSERT)
   ===================================================== */
async function recordSessionToSupabase(status = 'ONLINE', fullscreenStatus = 'FULL') {
    try {
        const deviceInfoStr = `${navigator.platform} | ${navigator.vendor}`;

        if (!sessionData.allow_multi_device && status === 'ONLINE') {
            const { data: existingSessions } = await db
                .from('live_sessions')
                .select('*')
                .eq('student_nisn', sessionData.nisn)
                .in('session_status', ['ONLINE', 'AWAY']);

            if (existingSessions && existingSessions.length > 0) {
                const activeSession = existingSessions[0];
                if (activeSession.device_info !== deviceInfoStr) {
                    handleSessionExpired("Akun sedang digunakan di perangkat lain");
                    return;
                }
            }
        }

        const { data, error } = await db
            .from('live_sessions')
            .upsert({
                school_npsn: sessionData.npsn,
                student_nisn: sessionData.nisn,
                student_name: sessionData.student_name,
                exam_id: sessionData.exam_id,
                session_status: status,
                fullscreen_status: fullscreenStatus === 'FULL',
                browser_info: navigator.userAgent,
                device_info: deviceInfoStr,
                ip_address: sessionData.userIP,
                last_seen: new Date().toISOString()
            }, { onConflict: 'student_nisn,device_info' })
            .select();

        if (error) throw error;

        if (data && data.length > 0) {
            const currentSession = data[0];
            if (currentSession.session_status === 'KICKED') {
                handleSessionExpired("Akun Anda telah di-kick / dinonaktifkan oleh pengawas.");
            }
        }

    } catch (err) {
        console.error('Heartbeat Supabase Error:', err);
    }
}

function startHeartbeat() {
    recordSessionToSupabase('ONLINE', 'FULL');

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

        recordSessionToSupabase(st, isFullscreen ? 'FULL' : 'WINDOWED');
    }, 15000);
}

function handleSessionExpired(message) {
    if (sessionData.heartbeatInterval) clearInterval(sessionData.heartbeatInterval);
    if (timerInterval) clearInterval(timerInterval);
    isExamActive = false;
    document.getElementById('examIframe').src = "about:blank";

    showSecurityModal({
        title: "Akses Ditolak",
        subtitle: "Sesi ujian dihentikan.",
        message: message,
        icon: "fa-ban"
    });
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
   SECURITY & VIOLATION LOGIC (SUPABASE DIRECT)
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

    window.addEventListener("pagehide", () => { handleIosBlurAction(); });

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
        await db.from('violations').insert([{
            school_npsn: sessionData.npsn,
            student_nisn: sessionData.nisn,
            student_name: sessionData.student_name,
            exam_id: sessionData.exam_id,
            violation_type: type,
            severity: 'WARNING'
        }]);

        const { data: sessionRow } = await db
            .from('live_sessions')
            .select('violation_count')
            .eq('student_nisn', sessionData.nisn)
            .eq('exam_id', sessionData.exam_id)
            .single();

        let newCount = sessionRow ? (sessionRow.violation_count + 1) : 1;

        await db
            .from('live_sessions')
            .update({ violation_count: newCount })
            .eq('student_nisn', sessionData.nisn)
            .eq('exam_id', sessionData.exam_id);

        let maxLimit = sessionData.max_violation;
        if (maxLimit !== "UNLIMITED" && sessionData.auto_kick_enabled) {
            if (newCount >= parseInt(maxLimit)) {
                await db
                    .from('live_sessions')
                    .update({ session_status: 'KICKED' })
                    .eq('student_nisn', sessionData.nisn);

                await db
                    .from('students')
                    .update({ account_status: 'INACTIVE' })
                    .eq('nisn', sessionData.nisn);

                showSecurityModal({
                    title: "Ujian Dihentikan",
                    subtitle: "Batas pelanggaran telah tercapai.",
                    message: "Akun ujian Anda dinonaktifkan sementara oleh sistem.",
                    icon: "fa-ban"
                });
            }
        }

    } catch (e) { console.log("Gagal log pelanggaran:", e); }
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
    
    const btnExit = document.getElementById('btnFinalExit');
    if (btnExit) {
        btnExit.disabled = false;
        btnExit.innerHTML = 'KELUAR';
    }
    
    const btnSubmit = document.getElementById('btnCloseExam');
    if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = 'SAYA SUDAH SUBMIT';
    }

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
    
    const btnExit = document.getElementById('btnFinalExit'); 
    const originalText = 'KELUAR';

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
            await db
                .from('live_sessions')
                .update({ session_status: 'DONE' })
                .eq('student_nisn', sessionData.nisn);
        } catch (err) { console.log("Gagal update status DONE, paksa reset."); }
        setTimeout(() => { resetExamSession(); }, 300);
    } else {
        document.getElementById('exitErrorMsg').classList.remove('hidden');
        const tokenInput = document.getElementById('exitTokenInput');
        if (tokenInput) { tokenInput.value = ""; tokenInput.focus(); }
        
        if (btnExit) { 
            btnExit.disabled = false; 
            btnExit.innerText = originalText; 
        }
    }
}

/* =====================================================
   PERBAIKAN FUNGSI RESET SESSION SETELAH KELUAR UJIAN
   ===================================================== */
function resetExamSession() {
    isExamActive = false;
    window.isForceClosing = false;
    if (sessionData.heartbeatInterval) clearInterval(sessionData.heartbeatInterval);
    if (timerInterval) clearInterval(timerInterval);
    stopAlarm();

    if (sessionData.wakeLock) { sessionData.wakeLock.release().catch(() => {}); }
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }

    // Sembunyikan layar ujian & dashboard siswa, tampilkan login utama
    document.getElementById('examIframe').src = "about:blank";
    document.getElementById('examWrapper').classList.replace('flex', 'hidden');
    document.getElementById('studentSection').classList.add('hidden');
    document.getElementById('mainLoginCard').classList.remove('hidden');
    document.getElementById('examTimer').innerText = "00:00:00";

    // Bersihkan input token keluar
    if (document.getElementById('exitTokenInput')) document.getElementById('exitTokenInput').value = "";

    currentZoom = 100; 
    correctToken = ""; 
    examLink = ""; 
    sessionData.exam_id = ""; 
    sessionData.exit_token = "";
    tutupModalExit();

    // Cek apakah fitur "Ingat ID saya" aktif
    const remember = document.getElementById('rememberId')?.checked;

    if (!remember) { 
        // Jika tidak dicentang, bersihkan seluruh localStorage dan kosongkan SEMUA input (Sekolah & NISN)
        localStorage.removeItem('smartExam_id'); 
        localStorage.removeItem('smartExam_npsn');
        localStorage.removeItem('smartExam_schoolName');

        const studentIdElem = document.getElementById('studentId');
        if (studentIdElem) studentIdElem.value = ""; 

        const schoolSearchInput = document.getElementById('schoolSearchInput');
        if (schoolSearchInput) schoolSearchInput.value = "";

        const selectedNpsnValue = document.getElementById('selectedNpsnValue');
        if (selectedNpsnValue) selectedNpsnValue.value = "";
    } else {
        // Jika dicentang, pertahankan data di form
        const nisnVal = document.getElementById('studentId')?.value;
        const npsnVal = document.getElementById('selectedNpsnValue')?.value;
        const schoolVal = document.getElementById('schoolSearchInput')?.value;

        if (nisnVal) localStorage.setItem('smartExam_id', nisnVal);
        if (npsnVal) localStorage.setItem('smartExam_npsn', npsnVal);
        if (schoolVal) localStorage.setItem('smartExam_schoolName', schoolVal);
    }
}
/* =====================================================
   FITUR TAB & SCHOOL AUTOCOMPLETE (MULTI-SCHOOL)
   ===================================================== */
function switchLoginRole(role) {
    const studentBtn = document.getElementById('tabStudentBtn');
    const teacherBtn = document.getElementById('tabTeacherBtn');
    const studentSec = document.getElementById('loginSection');
    const teacherSec = document.getElementById('teacherLoginSection');

    if (role === 'student') {
        // Aktifkan gaya tombol tab Siswa
        studentBtn.className = "py-2.5 text-xs font-bold rounded-xl transition-all bg-white text-purple-600 shadow-sm";
        teacherBtn.className = "py-2.5 text-xs font-bold rounded-xl transition-all text-slate-600 hover:text-slate-900";
        
        // Tampilkan form siswa, sembunyikan form guru
        studentSec.classList.remove('hidden');
        teacherSec.classList.add('hidden');
    } else {
        // Aktifkan gaya tombol tab Guru/Admin
        teacherBtn.className = "py-2.5 text-xs font-bold rounded-xl transition-all bg-white text-purple-600 shadow-sm";
        studentBtn.className = "py-2.5 text-xs font-bold rounded-xl transition-all text-slate-600 hover:text-slate-900";
        
        // Tampilkan form guru, sembunyikan form siswa
        teacherSec.classList.remove('hidden');
        studentSec.classList.add('hidden');
    }
}
function handleTeacherLoginPlaceholder() {
    showNotif('Modul Dashboard Guru sedang disiapkan!', 'info');
}

function handleSchoolRegistrationPlaceholder() {
    showNotif('Fitur registrasi sekolah mandiri segera hadir.', 'info');
}

// Variabel global untuk menampung seluruh daftar sekolah dari Supabase
window.allSchoolsData = [];

async function loadSchoolOptions() {
    try {
        const { data: schools, error } = await db
            .from('schools')
            .select('npsn, school_name')
            .eq('is_active', true);

        if (error) throw error;
        if (schools) {
            window.allSchoolsData = schools; // Simpan data ke memori lokal
        }
    } catch (err) {
        console.error("Gagal memuat daftar sekolah:", err);
    }
}

// **VALIDASI KETAT:** Fungsi Filter Interaktif saat Pengguna Mengetik Nama Sekolah
function filterSchools(keyword) {
    const dropdown = document.getElementById('schoolDropdown');
    const hiddenNpsn = document.getElementById('selectedNpsnValue');
    
    // Setiap kali pengguna mengetik ulang, wajibkan pilih ulang dari dropdown (reset NPSN)
    if (hiddenNpsn) hiddenNpsn.value = ""; 

    if (!keyword || keyword.trim() === "") {
        if (dropdown) {
            dropdown.classList.add('hidden');
            dropdown.innerHTML = '';
        }
        return;
    }

    const searchLower = keyword.toLowerCase();
    const filtered = window.allSchoolsData.filter(s => 
        s.school_name.toLowerCase().includes(searchLower) || s.npsn.includes(searchLower)
    );

    if (dropdown) {
        dropdown.innerHTML = '';

        if (filtered.length === 0) {
            dropdown.innerHTML = `
                <div class="p-3 text-xs text-rose-500 font-semibold text-center bg-rose-50/50">
                    <i class="fas fa-triangle-exclamation mr-1"></i> Sekolah tidak ditemukan dalam database
                </div>`;
        } else {
            filtered.forEach(school => {
                const item = document.createElement('div');
                item.className = "px-4 py-2.5 text-xs text-slate-700 font-medium hover:bg-purple-50 hover:text-purple-700 cursor-pointer border-b border-slate-50 last:border-none transition-colors";
                item.innerHTML = `${school.school_name} <span class="text-slate-400 font-normal">(${school.npsn})</span>`;
                
                // Ketika salah satu diklik oleh pengguna
                item.onclick = () => {
                    document.getElementById('schoolSearchInput').value = `${school.school_name} (${school.npsn})`;
                    if (hiddenNpsn) hiddenNpsn.value = school.npsn; // Kunci NPSN yang sah
                    dropdown.classList.add('hidden');
                };
                dropdown.appendChild(item);
            });
        }
        dropdown.classList.remove('hidden');
    }
}

// Tutup dropdown jika pengguna mengklik di luar area input
document.addEventListener('click', (e) => {
    const inputElem = document.getElementById('schoolSearchInput');
    const dropdownElem = document.getElementById('schoolDropdown');
    if (inputElem && dropdownElem && !inputElem.contains(e.target) && !dropdownElem.contains(e.target)) {
        dropdownElem.classList.add('hidden');
    }
});

// Fungsi untuk membuka/menutup modal pendaftaran tanpa pindah link URL
function toggleRegisterModal(show) {
    const modal = document.getElementById('registerModal');
    if (modal) {
        if (show) {
            modal.classList.remove('hidden');
        } else {
            modal.classList.add('hidden');
        }
    }
}

// **AUTO-REFRESH LIST:** Eksekusi pendaftaran via modal & perbarui memori sekolah otomatis
async function handleModalRegistration(e) {
    e.preventDefault();
    const npsn = document.getElementById('mRegNpsn').value.trim();
    const schoolName = document.getElementById('mRegSchoolName').value.trim();
    const email = document.getElementById('mRegEmail').value.trim();
    const whatsapp = document.getElementById('mRegWhatsapp').value.trim();
    const password = document.getElementById('mRegPassword').value.trim();
    const btn = document.getElementById('mSubmitBtn');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Memeriksa data...';

    try {
        // 1. VALIDASI PRE-CHECK: Cek apakah NPSN sudah terdaftar di tabel schools
        const { data: existingSchool, error: checkError } = await db
            .from('schools')
            .select('npsn, school_name')
            .eq('npsn', npsn)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existingSchool) {
            showNotif(`Gagal: NPSN ${npsn} sudah terdaftar atas nama sekolah "${existingSchool.school_name}"!`, 'error');
            btn.disabled = false;
            btn.innerHTML = 'Simpan & Daftarkan Sekolah';
            return;
        }

        // 2. VALIDASI PRE-CHECK: Cek apakah Email sudah digunakan oleh user/proktor lain
        const { data: existingUser, error: checkUserError } = await db
            .from('users')
            .select('email')
            .eq('email', email)
            .maybeSingle();

        if (checkUserError) throw checkUserError;

        if (existingUser) {
            showNotif(`Gagal: Email ${email} sudah digunakan oleh operator lain!`, 'error');
            btn.disabled = false;
            btn.innerHTML = 'Simpan & Daftarkan Sekolah';
            return;
        }

        // 3. VALIDASI PRE-CHECK: Cek apakah Nomor WhatsApp sudah digunakan
        const { data: existingWa, error: checkWaError } = await db
            .from('schools')
            .select('whatsapp_number, school_name')
            .eq('whatsapp_number', whatsapp)
            .maybeSingle();

        if (checkWaError) throw checkWaError;

        if (existingWa) {
            showNotif(`Gagal: Nomor WhatsApp ${whatsapp} sudah digunakan oleh sekolah "${existingWa.school_name}"!`, 'error');
            btn.disabled = false;
            btn.innerHTML = 'Simpan & Daftarkan Sekolah';
            return;
        }

        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Memproses pendaftaran...';

        // 4. Simpan ke Database Supabase (Tabel schools) - DIPERBAIKI (Kurung siku diganti titik)
        const { error: schoolError } = await db.from('schools').insert({
            npsn: npsn,
            school_name: schoolName,
            email: email,
            whatsapp_number: whatsapp,
            is_active: true
        });

        if (schoolError) throw schoolError;

        // 5. Simpan ke Database Supabase (Tabel users untuk login admin)
        const { error: userError } = await db.from('users').insert({
            school_npsn: npsn,
            school_name: schoolName,
            operator_name: 'Admin Proktor',
            email: email,
            role: 'admin',
            password: password,
            is_active: true
        });

        if (userError) throw userError;

        // 6. Kirim data ke Google Sheets melalui URL Web App Google Apps Script
        const googleScriptUrl = "https://script.google.com/macros/s/AKfycbwhnXGN_a1nQdTkHsuVuTvNAhp_1LQbj6m4uPTzNd4gusB_Z7IL_tbp5YmE2WZcm1ZeNA/exec";
        if (googleScriptUrl && googleScriptUrl.startsWith("https://")) {
            fetch(googleScriptUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ npsn, schoolName, email, whatsapp, password })
            }).catch(err => console.log("Gagal sync ke Google Sheets:", err));
        }

        showNotif('Sekolah & akun admin berhasil didaftarkan!', 'success');
        toggleRegisterModal(false);
        e.target.reset();

        // Tarik ulang daftar sekolah terbaru ke memori
        await loadSchoolOptions();

    } catch (err) {
        console.error(err);
        showNotif('Gagal mendaftar: ' + (err.message || 'Kesalahan sistem'), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Simpan & Daftarkan Sekolah';
    }
}
/* =====================================================
   KEMBALI KE HALAMAN LOGIN UTAMA (DARI DASHBOARD SISWA)
   ===================================================== */
function logoutToLogin() {
    // Reset variabel sesi penting
    sessionData.npsn = "";
    sessionData.nisn = "";
    sessionData.student_name = "";
    sessionData.exam_id = "";
    sessionData.exit_token = "";

    // Sembunyikan section dashboard siswa
    const studentSection = document.getElementById('studentSection');
    if (studentSection) {
        studentSection.classList.add('hidden');
    }

    // Tampilkan kembali card login utama
    const mainLoginCard = document.getElementById('mainLoginCard');
    if (mainLoginCard) {
        mainLoginCard.classList.remove('hidden');
    }

    // Kosongkan kontainer daftar ujian agar tidak menumpuk
    const examContainer = document.getElementById('examContainer');
    if (examContainer) {
        examContainer.innerHTML = '';
    }

    // Cek status checkbox 'Ingat ID saya'
    const remember = document.getElementById('rememberId')?.checked;

    if (!remember) { 
        // Jika tidak dicentang, bersihkan penyimpanan lokal dan kosongkan SEMUA input (Sekolah & NISN)
        localStorage.removeItem('smartExam_id'); 
        
        const studentIdElem = document.getElementById('studentId');
        if (studentIdElem) studentIdElem.value = ""; 

        const schoolSearchInput = document.getElementById('schoolSearchInput');
        if (schoolSearchInput) schoolSearchInput.value = "";

        const selectedNpsnValue = document.getElementById('selectedNpsnValue');
        if (selectedNpsnValue) selectedNpsnValue.value = "";
    } else {
        // Jika dicentang, NISN tetap diingat, tapi kita pastikan ID-nya tersimpan ke localStorage
        const nisnVal = document.getElementById('studentId')?.value;
        if (nisnVal) {
            localStorage.setItem('smartExam_id', nisnVal);
        }
    }

    showNotif('Kembali ke menu login', 'info');
}
