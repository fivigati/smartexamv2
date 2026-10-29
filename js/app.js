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
    const nisnInput = document.getElementById('studentId').value.trim();
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Memverifikasi...';
    
    try {
        // 1. Ambil data siswa dari tabel Supabase
        const { data: student, error: studentError } = await db
            .from('students')
            .select('*, schools(school_name)')
            .eq('nisn', nisnInput)
            .single();

        if (studentError || !student) {
            showNotif('NISN tidak ditemukan', 'error');
            return;
        }

        if ((student.account_status || '').toUpperCase() === 'INACTIVE') {
            showNotif('Akun dinonaktifkan karena pelanggaran ujian', 'error');
            return;
        }

        const schoolNpsn = student.school_npsn;

        // 2. Ambil konfigurasi sekolah / global dari tabel _config
        const { data: configRows } = await db
            .from('_config')
            .select('key, value')
            .in('school_npsn', [schoolNpsn, 'GLOBAL']);

        let configMap = {
            min_exit_minutes: 0,
            max_violation: 'UNLIMITED',
            auto_kick_enabled: false,
            allow_multi_device: true,
            heartbeat_enabled: true
        };

        if (configRows) {
            configRows.forEach(cfg => {
                // Utamakan config spesifik sekolah, timpa nilai global
                if (cfg.school_npsn === schoolNpsn || !configMap[cfg.key]) {
                    if (cfg.value === 'TRUE' || cfg.value === 'true') configMap[cfg.key] = true;
                    else if (cfg.value === 'FALSE' || cfg.value === 'false') configMap[cfg.key] = false;
                    else configMap[cfg.key] = cfg.value;
                }
            });
        }

        // 3. Simpan state sesi
        sessionData.nisn = student.nisn;
        sessionData.student_name = student.full_name;
        sessionData.npsn = schoolNpsn;
        sessionData.minExitMinutes = parseInt(configMap.min_exit_minutes || 0);
        sessionData.max_violation = configMap.max_violation;
        sessionData.auto_kick_enabled = configMap.auto_kick_enabled;
        sessionData.allow_multi_device = configMap.allow_multi_device;
        sessionData.heartbeat_enabled = configMap.heartbeat_enabled;

        const remember = document.getElementById('rememberId').checked;
        if (remember) {
            localStorage.setItem('smartExam_id', nisnInput);
        } else {
            localStorage.removeItem('smartExam_id');
        }

        // Tampilkan identitas ke UI
        document.getElementById('loginSection').classList.add('hidden');
        document.getElementById('studentSection').classList.remove('hidden');
        document.getElementById('studentName').innerText = student.full_name;
        document.getElementById('studentClass').innerText = student.class_name;
        document.getElementById('studentSchool').innerText = student.schools?.school_name || "Sekolah";

        // 4. Ambil daftar ujian aktif yang sesuai dengan siswa
        await fetchAndRenderActiveExams(student);
        showNotif('Identitas terverifikasi', 'success');

    } catch (err) {
        showNotif('Gagal terhubung ke database ujian', 'error');
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Verifikasi ID';
    }
}

/* =====================================================
   MULTI-EXAM DASHBOARD RENDERER
   ===================================================== */
async function fetchAndRenderActiveExams(student) {
    const container = document.getElementById('examContainer');
    const nowISO = new Date().toISOString();

    // Ambil ujian aktif berdasarkan sekolah dan rentang waktu start_time <= now <= end_time
    const { data: exams, error } = await db
        .from('exams')
        .select('*')
        .eq('school_npsn', student.school_npsn)
        .eq('exam_status', 'ACTIVE')
        .lte('start_time', nowISO)
        .gte('end_time', nowISO);

    if (error || !exams || exams.length === 0) {
        container.innerHTML = `<div class="bg-slate-50/50 border border-dashed border-slate-200 rounded-[2rem] p-8 text-center fade-in"><i class="fas fa-calendar-times text-slate-200 text-3xl mb-3"></i><div class="text-xs font-bold text-slate-400 uppercase tracking-widest">Tidak Ada Jadwal Aktif</div></div>`;
        return;
    }

    const studentClass = student.class_name.toUpperCase().trim();
    const studentDesc = (student.description || "").toUpperCase().trim();
    const gradeLevel = student.class_name.replace(/[^0-9]/g, '');

    let validExams = [];

    exams.forEach(exam => {
        const targets = exam.target_class.toUpperCase().split(',').map(t => t.trim());
        const isCategoryMatch = studentDesc !== "" && targets.includes(studentDesc);
        const isClassMatch = targets.includes(studentClass);
        const isLevelMatch = targets.includes('ALL_' + gradeLevel) || targets.includes('ALL');

        if (isCategoryMatch || isClassMatch || isLevelMatch) {
            validExams.push(exam);
        }
    });

    if (validExams.length === 0) {
        container.innerHTML = `<div class="bg-slate-50/50 border border-dashed border-slate-200 rounded-[2rem] p-8 text-center fade-in"><i class="fas fa-ban text-slate-200 text-3xl mb-3"></i><div class="text-xs font-bold text-slate-400 uppercase tracking-widest">Ujian Tidak Tersedia Untuk Kelas Anda</div></div>`;
        return;
    }

    // Render kartu pilihan ujian (Multi-Exam List)
    let htmlContent = '<div class="space-y-4 text-left">';
    validExams.forEach((exam, index) => {
        const startTimeStr = new Date(exam.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endTimeStr = new Date(exam.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        htmlContent += `
            <div class="bg-white rounded-[1.5rem] shadow-sm p-4 border border-indigo-100/60 fade-in">
                <div class="flex items-center justify-between mb-2">
                    <span class="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border border-emerald-100">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Tersedia
                    </span>
                    <span class="text-[10px] font-bold text-slate-400"><i class="far fa-clock mr-1 text-indigo-400"></i> ${startTimeStr} - ${endTimeStr}</span>
                </div>
                <h4 class="text-xs font-extrabold text-slate-800 mb-2">${exam.subject} (${exam.duration_minutes} Menit)</h4>
                <div class="space-y-2">
                    <input type="text" id="tokenInput_${exam.exam_id}" placeholder="MASUKKAN TOKEN" class="block w-full px-3 py-2.5 text-center text-sm tracking-[0.2em] text-indigo-600 rounded-xl font-black uppercase bg-[#F8FAFF] border border-[#EDF2FF] focus:bg-white focus:border-indigo-500 outline-none transition-all">
                    <button onclick="selectAndStartExam(${exam.exam_id}, '${encodeURIComponent(exam.subject)}', '${exam.entry_token}', '${exam.exam_link}', ${exam.duration_minutes}, '${exam.exit_token || ""}')" class="btn-gradient w-full py-2.5 text-white font-bold rounded-xl text-xs">Mulai Ujian Ini</button>
                </div>
            </div>`;
    });
    htmlContent += '</div>';

    container.innerHTML = htmlContent;
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

        // Daftarkan sesi ke live_sessions Supabase
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

        // 1. Cek Validasi Multi-Device jika diaktifkan config-nya
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

        // 2. Upsert Sesi ke tabel live_sessions (berdasarkan Unique Index student_nisn & device_info)
        const { data, error } = await db
            .from('live_sessions')
            .upsert({
                school_npsn: sessionData.npsn,
                student_nisn: sessionData.nisn,
                student_name: sessionData.student_name, // Trigger database juga akan mengamankan ini
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

        // Cek jika status di-kick atau di-banned oleh admin
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
        // 1. Simpan log pelanggaran ke tabel violations Supabase
        await db.from('violations').insert([{
            school_npsn: sessionData.npsn,
            student_nisn: sessionData.nisn,
            student_name: sessionData.student_name,
            exam_id: sessionData.exam_id,
            violation_type: type,
            severity: 'WARNING'
        }]);

        // 2. Ambil dan update violation_count di live_sessions
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

        // 3. Cek batas max_violation & auto-kick
        let maxLimit = sessionData.max_violation;
        if (maxLimit !== "UNLIMITED" && sessionData.auto_kick_enabled) {
            if (newCount >= parseInt(maxLimit)) {
                // Update status jadi KICKED
                await db
                    .from('live_sessions')
                    .update({ session_status: 'KICKED' })
                    .eq('student_nisn', sessionData.nisn);

                // Nonaktifkan status akun siswa
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
            // Update status sesi menjadi DONE di Supabase
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

    if (document.getElementById('exitTokenInput')) document.getElementById('exitTokenInput').value = "";

    currentZoom = 100; correctToken = ""; examLink = ""; sessionData.exam_id = ""; sessionData.exit_token = "";
    tutupModalExit();

    const remember = document.getElementById('rememberId').checked;
    if (!remember) { localStorage.removeItem('smartExam_id'); document.getElementById('studentId').value = ""; }
}
