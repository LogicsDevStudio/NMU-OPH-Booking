// ==========================================
// 1. ตั้งค่า Firebase และ Google Sheet
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyBV797BWmJYZMjvIgX9RNrG0rPdJuG8-zg",
    authDomain: "nmu-oph-booking.firebaseapp.com",
    databaseURL: "https://nmu-oph-booking-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "nmu-oph-booking",
    storageBucket: "nmu-oph-booking.firebasestorage.app",
    messagingSenderId: "471706201668",
    appId: "1:471706201668:web:7d539fa6f43fee1f485611"
};
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwaVPfVXWI8Ox6uoiNuHE5ZzyTEdh296SSjZ0vJpTp4KEZe-qcVHYmxIsWH4aym-v3L0w/exec";

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

let currentUser = null;
let selectedSeatId = null;

// ใช้สำหรับสร้างบัญชี Staff โดยไม่กระทบกับ Auth ของ Admin ที่กำลังล็อกอินอยู่
const secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
let currentUserData = null; // เก็บข้อมูล Role และสิทธิ์ของคนที่ล็อกอินอยู่
let html5QrcodeScanner = null; // ตัวแปรสำหรับกล้องสแกน

// ตัวแปรสำหรับจัดการรีเฟรชที่นั่ง
let currentRoundListenerId = null; 
let seatRefreshInterval = null; 

// ==========================================
// 2. ระบบสลับหน้า และ จัดการ UI Bootstrap
// ==========================================
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
    document.getElementById(pageId).style.display = 'block';
}

function closeOffcanvas() {
    const offcanvasEl = document.getElementById('sidebarMenu');
    const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasEl);
    if (offcanvasInstance) offcanvasInstance.hide();
}

// ==========================================
// 3. ระบบ Authentication
// ==========================================
// กำหนดอีเมลที่จะเป็น Super Admin อัตโนมัติ
const SUPER_ADMIN_EMAIL = "admin1@test.com"; 

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        
        try {
            // ดึงข้อมูลผู้ใช้จาก Database
            let snapshot = await db.ref('users/' + user.uid).once('value');
            let userData = snapshot.val();

            // ระบบทำงานอัตโนมัติ: ถ้าล็อกอินครั้งแรกและตรงกับอีเมล Super Admin ให้สร้างโปรไฟล์ลง DB เลย
            if (!userData && user.email === SUPER_ADMIN_EMAIL) {
                userData = { email: user.email, role: 'admin' };
                await db.ref('users/' + user.uid).set(userData);
            }

            // ถ้าไม่มีข้อมูลในระบบเลย ให้ถือว่าเป็น staff ธรรมดา
            currentUserData = userData || { role: 'staff' };
            const role = currentUserData.role;
            
            // สลับ UI บน Navbar
            document.getElementById('nav-login-btn').classList.add('d-none');
            document.getElementById('btn-sidebar-toggle').classList.remove('d-none');
            
            // แสดงเมนูพื้นฐานสำหรับ Staff ทุกคน
            document.getElementById('nav-booking').style.display = 'block';
            document.getElementById('nav-checkin').style.display = 'block';
            document.getElementById('nav-logout').style.display = 'block';
            
            // กำหนดการแสดงผลเมนูอัตโนมัติ: โชว์เมนู Admin เฉพาะแอดมินเท่านั้น
            document.querySelectorAll('.admin-menu').forEach(el => {
                el.style.display = (role === 'admin') ? 'block' : 'none';
            });
            
            loadStationsDropdown();
            showPage('booking-page');
            closeOffcanvas();

        } catch (err) {
            console.error("Error loading user profile:", err);
            alert("เกิดข้อผิดพลาดในการโหลดข้อมูลสิทธิ์การใช้งาน");
        }
    } else {
        currentUser = null;
        currentUserData = null;
        if(html5QrcodeScanner) html5QrcodeScanner.clear(); // ปิดกล้องถ้าล็อกเอาท์
        
        // ซ่อนเมนูทุกอย่าง กลับสู่หน้า Public
        document.getElementById('nav-login-btn').classList.remove('d-none');
        document.getElementById('btn-sidebar-toggle').classList.add('d-none');
        document.getElementById('nav-booking').style.display = 'none';
        document.getElementById('nav-checkin').style.display = 'none';
        document.querySelectorAll('.admin-menu').forEach(el => el.style.display = 'none');
        document.getElementById('nav-logout').style.display = 'none';
        
        showPage('public-page');
    }
});

function login() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    auth.signInWithEmailAndPassword(email, pass)
        .catch(err => alert("เข้าสู่ระบบไม่สำเร็จ: " + err.message));
}

function logout() { auth.signOut(); }

// ==========================================
// 4. หน้า Public (Dashboard แบบ Bootstrap Card)
// ==========================================
db.ref('rounds').on('value', async (snapshot) => {
    const rounds = snapshot.val();
    const dashboard = document.getElementById('dashboard-content');
    dashboard.innerHTML = '';
    
    if (!rounds) { 
        dashboard.innerHTML = '<div class="col-12 text-center text-muted">ไม่มีข้อมูลรอบกิจกรรม</div>'; 
        return; 
    }

    const stationsSnap = await db.ref('stations').once('value');
    const stations = stationsSnap.val() || {};

    for (let key in rounds) {
        const r = rounds[key];
        const stationName = stations[r.station_id]?.name || 'ไม่ทราบชื่อฐาน';
        
        // คำนวณ % การจองเพื่อทำ Progress bar
        const percent = ((r.total_seats - r.available_seats) / r.total_seats) * 100;
        let pColor = 'bg-success';
        if(percent > 70) pColor = 'bg-warning';
        if(percent === 100) pColor = 'bg-danger';

        dashboard.innerHTML += `
            <div class="col-md-6 col-lg-4">
                <div class="card shadow-sm border-0 h-100">
                    <div class="card-body">
                        <h5 class="card-title fw-bold text-primary mb-1">${stationName}</h5>
                        <p class="text-muted small mb-3"><i class="bi bi-clock"></i> เวลา: ${r.time_start} - ${r.time_end}</p>
                        
                        <div class="d-flex justify-content-between mb-1">
                            <span class="small fw-bold">ที่ว่าง</span>
                            <span class="small fw-bold text-${r.available_seats > 0 ? 'success' : 'danger'}">${r.available_seats} / ${r.total_seats}</span>
                        </div>
                        <div class="progress" style="height: 10px;">
                            <div class="progress-bar ${pColor}" role="progressbar" style="width: ${percent}%"></div>
                        </div>
                    </div>
                </div>
            </div>`;
    }
});

// ==========================================
// 5. ระบบ Admin (เพิ่มฐาน/รอบ)
// ==========================================
function addStation() {
    const name = document.getElementById('new-station-name').value;
    if (!name) return alert("กรุณาใส่ชื่อฐาน");
    db.ref('stations').push({ name: name }).then(() => {
        alert("เพิ่มฐานสำเร็จ!");
        document.getElementById('new-station-name').value = '';
        loadStationsDropdown();
    });
}

function addRound() {
    const stationId = document.getElementById('admin-station-select').value;
    const tStart = document.getElementById('time-start').value;
    const tEnd = document.getElementById('time-end').value;
    const total = parseInt(document.getElementById('total-seats').value);
    
    if(!stationId || !tStart || !tEnd || !total) return alert("กรอกข้อมูลให้ครบ");

    const roundRef = db.ref('rounds').push();
    roundRef.set({
        station_id: stationId,
        time_start: tStart,
        time_end: tEnd,
        total_seats: total,
        available_seats: total
    }).then(() => {
        let seats = {};
        for(let i=1; i<=total; i++) {
            seats[`seat_${i}`] = { status: 'available', booked_by: '' };
        }
        db.ref(`seats/${roundRef.key}`).set(seats);
        alert("เพิ่มรอบและสร้างที่นั่งสำเร็จ!");
    });
}

function loadStationsDropdown() {
    db.ref('stations').once('value', (snap) => {
        const stations = snap.val();
        let bookingHtml = '<option value="">-- เลือกฐานกิจกรรม --</option>';
        let adminHtml = bookingHtml;
        let checkboxesHtml = '';

        for (let key in stations) {
            const stName = stations[key].name;
            adminHtml += `<option value="${key}">${stName}</option>`;
            checkboxesHtml += `<div class="form-check"><input class="form-check-input station-cb" type="checkbox" value="${key}" id="cb-${key}"><label class="form-check-label" for="cb-${key}">${stName}</label></div>`;
            
            // เช็คสิทธิ์การมองเห็นสำหรับหน้าจองที่นั่ง
            if (currentUserData.role === 'admin' || (currentUserData.allowed_stations && currentUserData.allowed_stations[key])) {
                bookingHtml += `<option value="${key}">${stName}</option>`;
            }
        }
        
        // อัปเดต Dropdown ตามหน้าต่างๆ
        if(document.getElementById('admin-station-select')) document.getElementById('admin-station-select').innerHTML = adminHtml;
        if(document.getElementById('station-select')) document.getElementById('station-select').innerHTML = bookingHtml;
        if(document.getElementById('staff-stations-checkboxes')) document.getElementById('staff-stations-checkboxes').innerHTML = checkboxesHtml;
    });
}

function loadRoundsForBooking() {
    const stationId = document.getElementById('station-select').value;
    document.getElementById('round-select').innerHTML = '<option value="">-- เลือกรอบ --</option>';
    document.getElementById('seat-map').innerHTML = '<div class="text-center text-muted w-100 py-5">กรุณาเลือกรอบกิจกรรมเพื่อดูที่นั่ง</div>';
    
    // เคลียร์ตัวแปรและหยุด Auto-Refresh ป้องกันที่นั่งของฐานเก่าโผล่มาหลอกตา
    if(seatRefreshInterval) clearInterval(seatRefreshInterval);
    window.currentSeatsData = null;
    if (currentRoundListenerId) {
        db.ref(`seats/${currentRoundListenerId}`).off('value');
        currentRoundListenerId = null;
    }
    
    db.ref('rounds').orderByChild('station_id').equalTo(stationId).once('value', (snap) => {
        const rounds = snap.val();
        for (let key in rounds) {
            document.getElementById('round-select').innerHTML += `<option value="${key}">${rounds[key].time_start} - ${rounds[key].time_end}</option>`;
        }
    });
}

// ==========================================
// 6. ระบบ Staff (ดึงข้อมูล และระบบที่นั่ง Realtime)
// ==========================================
async function fetchUserData() {
    const nationalId = document.getElementById('national-id').value;
    if(nationalId.length !== 13) return alert("กรุณากรอกบัตรประชาชน 13 หลัก");

    document.getElementById('display-name').innerText = "กำลังค้นหา...";
    try {
        const response = await fetch(`${GOOGLE_SCRIPT_URL}?id=${nationalId}`);
        const data = await response.json();
        
        if (data.found) {
            document.getElementById('display-name').innerText = data.name;
            document.getElementById('display-phone').innerText = data.phone;
            document.getElementById('user-data-form').style.display = 'block';
        } else {
            alert('ไม่พบข้อมูลในระบบส่วนกลาง');
            document.getElementById('display-name').innerText = "";
            document.getElementById('user-data-form').style.display = 'none';
        }
    } catch (err) { alert("เกิดข้อผิดพลาดในการดึงข้อมูล"); }
}

function loadSeats() {
    const roundId = document.getElementById('round-select').value;
    if(!roundId) return;

    // ยกเลิก Listener ของรอบเก่าก่อน ป้องกันข้อมูลตีกันและลดโหลด
    if (currentRoundListenerId) {
        db.ref(`seats/${currentRoundListenerId}`).off('value');
    }
    currentRoundListenerId = roundId;

    if(seatRefreshInterval) clearInterval(seatRefreshInterval);

    const map = document.getElementById('seat-map');
    
    // ฟังก์ชันย่อยสำหรับวาดที่นั่ง
    const renderSeats = (seats) => {
        if(!map) return;
        map.innerHTML = '';
        if (!seats) return;

        const now = Date.now();
        const TIMEOUT = 60000; // 1 นาที (60000 ms)

        // 1. คัดกรองและเรียงลำดับที่นั่งจากน้อยไปมาก
        let seatKeys = Object.keys(seats).filter(key => key.startsWith('seat_'));
        seatKeys.sort((a, b) => parseInt(a.replace('seat_', '')) - parseInt(b.replace('seat_', '')));

        // 2. วนลูปวาดที่นั่ง
        seatKeys.forEach(key => {
            const s = seats[key];
            const div = document.createElement('div');
            let statusClass = 'available';

            if (s.status === 'booked') {
                statusClass = 'booked';
            } else if (s.status === 'disabled') {
                statusClass = 'disabled';
            } else if (s.selecting_by && (now - s.selection_time < TIMEOUT)) {
                if (s.selecting_by === currentUser.uid) {
                    statusClass = 'my-selection'; 
                } else {
                    statusClass = 'selecting'; 
                }
            }

            div.className = `seat ${statusClass}`;
            div.innerText = key.replace('seat_', '');
            
            div.onclick = () => {
                if (statusClass === 'available') {
                    selectSeat(roundId, key);
                } else if (statusClass === 'my-selection') {
                    deselectSeat(roundId, key);
                } else if (statusClass === 'booked') {
                    alert("ที่นั่งนี้ถูกจองไปแล้ว");
                } else if (statusClass === 'selecting') {
                    alert("มีเจ้าหน้าที่ท่านอื่นกำลังทำรายการที่นั่งนี้");
                } else if (statusClass === 'disabled') {
                    alert("ที่นั่งนี้ถูกปิดการใช้งาน");
                }
            };

            map.appendChild(div);
        });
    };

    // เปิดรับข้อมูล Realtime จาก Firebase
    db.ref(`seats/${roundId}`).on('value', (snap) => {
        const seats = snap.val();
        window.currentSeatsData = seats; // เก็บข้อมูลล่าสุดไว้ในตัวแปรสำหรับอัปเดต UI อัตโนมัติ
        renderSeats(seats);
    });

    // ระบบ Auto-Refresh: สั่งรีเฟรชหน้าจอที่นั่งทุกๆ 10 วินาที
    seatRefreshInterval = setInterval(() => {
        if(window.currentSeatsData) {
            renderSeats(window.currentSeatsData);
        }
    }, 10000); 
}

function selectSeat(roundId, seatId) {
    clearMyPreviousSelection(roundId);
    db.ref(`seats/${roundId}/${seatId}`).update({
        selecting_by: currentUser.uid,
        selection_time: Date.now()
    });
    selectedSeatId = seatId;
}

function deselectSeat(roundId, seatId) {
    db.ref(`seats/${roundId}/${seatId}`).update({
        selecting_by: null,
        selection_time: null
    });
    selectedSeatId = null;
}

function clearMyPreviousSelection(roundId) {
    db.ref(`seats/${roundId}`).once('value', (snap) => {
        const seats = snap.val();
        for (let key in seats) {
            if (seats[key].selecting_by === currentUser.uid) {
                db.ref(`seats/${roundId}/${key}`).update({
                    selecting_by: null,
                    selection_time: null
                });
            }
        }
    });
}

// ==========================================
// 7. ระบบยืนยันการจอง และ สร้าง QR Code
// ==========================================
function confirmBooking() {
    const roundId = document.getElementById('round-select').value;
    const nationalId = document.getElementById('national-id').value;
    
    if(!roundId || !selectedSeatId || !nationalId) {
        return alert("กรุณาเลือกที่นั่งและใส่ข้อมูลผู้เข้าร่วมให้ครบถ้วน");
    }

    const seatRef = db.ref(`seats/${roundId}/${selectedSeatId}`);
    
    seatRef.transaction((currentData) => {
        // ป้องกัน Error "Cannot read property 'status' of null" 
        if (currentData === null) return null; 
        
        // ถ้าโดนคนอื่นจองตัดหน้าไปแล้ว ให้ยกเลิก
        if (currentData.status === 'booked') return; 

        currentData.status = 'booked';
        currentData.booked_by = nationalId;
        currentData.selecting_by = null;
        currentData.selection_time = null;
        return currentData;
    }, (error, committed) => {
        if (committed) {
            const bookingId = "BK-" + Date.now();
            db.ref(`bookings/${bookingId}`).set({
                national_id: nationalId,
                round_id: roundId,
                seat_id: selectedSeatId,
                timestamp: Date.now()
            });
            
            // ตัดสต๊อกที่นั่ง
            db.ref(`rounds/${roundId}/available_seats`).transaction(c => (c || 0) - 1);

            generateQR(bookingId);
            
            // ล้างฟอร์ม
            selectedSeatId = null; 
            document.getElementById('national-id').value = '';
            document.getElementById('user-data-form').style.display = 'none';
        } else {
            alert("จองไม่สำเร็จ ที่นั่งอาจถูกจองตัดหน้าไปแล้ว กรุณาเลือกรอบ/ที่นั่งใหม่");
        }
    });
}

function generateQR(text) {
    document.getElementById("qrcode-container").innerHTML = "";
    document.getElementById("qr-ref").innerText = text;
    
    new QRCode(document.getElementById("qrcode-container"), { 
        text: text, 
        width: 150, 
        height: 150 
    });

    const qrModal = new bootstrap.Modal(document.getElementById('qrModal'));
    qrModal.show();
}

// ==========================================
// ระบบ Check-in สแกน QR Code
// ==========================================
function initScanner() {
    if(html5QrcodeScanner) html5QrcodeScanner.clear();
    html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

function onScanSuccess(decodedText, decodedResult) {
    html5QrcodeScanner.pause(true); // หยุดสแกนชั่วคราวกันสแกนซ้ำรัวๆ
    processCheckIn(decodedText);
}
function onScanFailure(error) { /* ไม่ต้องทำอะไร รอจนกว่าจะสแกนติด */ }

function manualCheckIn() {
    const id = document.getElementById('manual-booking-id').value.trim();
    if(id) processCheckIn(id);
}

async function processCheckIn(bookingId) {
    try {
        const ref = db.ref(`bookings/${bookingId}`);
        const snap = await ref.once('value');
        
        if (!snap.exists()) {
            alert("❌ ไม่พบข้อมูลการจองนี้ในระบบ");
            if(html5QrcodeScanner) html5QrcodeScanner.resume();
            return;
        }

        const data = snap.val();
        if (data.status === 'checked-in') {
            alert(`⚠️ ตั๋วนี้ถูกสแกนเช็คอินไปแล้ว!\nเวลา: ${new Date(data.checkin_time).toLocaleString()}`);
        } else {
            // อัปเดตสถานะเป็น check-in
            await ref.update({ 
                status: 'checked-in', 
                checkin_time: Date.now(),
                checkin_by: currentUser.uid 
            });
            alert("✅ เช็คอินสำเร็จ!");
        }
    } catch (err) {
        alert("เกิดข้อผิดพลาด: " + err.message);
    }
    
    document.getElementById('manual-booking-id').value = '';
    if(html5QrcodeScanner) html5QrcodeScanner.resume();
}

// ==========================================
// ระบบจัดการ Staff (Admin Only)
// ==========================================
async function createStaff() {
    const email = document.getElementById('staff-email').value;
    const password = document.getElementById('staff-password').value;
    const role = document.getElementById('staff-role').value;
    
    if(!email || password.length < 6) return alert("กรุณากรอกอีเมลและรหัสผ่านขั้นต่ำ 6 ตัว");

    // ดึงค่า checkbox ว่าให้คุมฐานไหนบ้าง
    let allowed_stations = {};
    document.querySelectorAll('.station-cb:checked').forEach(cb => {
        allowed_stations[cb.value] = true;
    });

    try {
        // 1. ป้องกันไม่ให้ Secondary App จำการล็อกอิน
        await secondaryApp.auth().setPersistence(firebase.auth.Auth.Persistence.NONE);
        
        // 2. ใช้ Secondary App สร้าง Auth
        const userCred = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
        const newUid = userCred.user.uid;

        // 3. เตรียมข้อมูลที่จะบันทึก
        const userData = {
            email: email,
            role: role
        };
        if (Object.keys(allowed_stations).length > 0) {
            userData.allowed_stations = allowed_stations;
        }

        // 4. บันทึกข้อมูลลง Database
        await db.ref(`users/${newUid}`).set(userData);

        alert("เพิ่มเจ้าหน้าที่สำเร็จ!");
        document.getElementById('staff-email').value = '';
        document.getElementById('staff-password').value = '';
        
        // โหลดรายการในตารางใหม่
        loadStaffList();

    } catch (error) {
        console.error("Error creating staff:", error);
        alert("สร้างบัญชีไม่สำเร็จ: " + error.message);
    }
}

function loadStaffList() {
    db.ref('users').on('value', async (snap) => {
        const users = snap.val();
        const tbody = document.getElementById('staff-table-body');
        tbody.innerHTML = '';
        
        const stationsSnap = await db.ref('stations').once('value');
        const stations = stationsSnap.val() || {};

        for (let uid in users) {
            const u = users[uid];
            let stationBadges = '';
            if (u.role === 'admin') {
                stationBadges = '<span class="badge bg-primary">All (Admin)</span>';
            } else if (u.allowed_stations) {
                for(let stId in u.allowed_stations) {
                    stationBadges += `<span class="badge bg-secondary me-1">${stations[stId]?.name || 'Unknown'}</span>`;
                }
            } else {
                stationBadges = '<span class="text-muted small">ไม่มีสิทธิ์</span>';
            }

            tbody.innerHTML += `
                <tr>
                    <td>${u.email || 'N/A'}</td>
                    <td><span class="badge ${u.role === 'admin' ? 'bg-danger' : 'bg-success'}">${u.role.toUpperCase()}</span></td>
                    <td>${stationBadges}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteStaff('${uid}')"><i class="bi bi-trash"></i></button>
                    </td>
                </tr>
            `;
        }
    });
}

function deleteStaff(uid) {
    if(confirm("ยืนยันการลบข้อมูลเจ้าหน้าที่นี้? (ผู้ใช้จะยังล็อกอินได้หากไม่ลบใน Authentication Console แต่จะไม่มีสิทธิ์ในระบบ)")) {
        db.ref(`users/${uid}`).remove().then(() => alert('ลบสำเร็จ'));
    }
}

// ==========================================
// ระบบจัดการรายการจอง (Admin Only)
// ==========================================
async function loadAllBookings() {
    try {
        const [bookingsSnap, roundsSnap, stationsSnap] = await Promise.all([
            db.ref('bookings').once('value'),
            db.ref('rounds').once('value'),
            db.ref('stations').once('value')
        ]);

        const bookings = bookingsSnap.val() || {};
        const rounds = roundsSnap.val() || {};
        const stations = stationsSnap.val() || {};
        const tbody = document.getElementById('bookings-table-body');
        tbody.innerHTML = '';

        if(Object.keys(bookings).length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">ไม่มีรายการจอง</td></tr>';
            return;
        }

        for (let bId in bookings) {
            const b = bookings[bId];
            
            // ป้องกัน Error กรณีข้อมูลไม่ครบ
            const roundId = b.round_id || 'ไม่ระบุ';
            const round = rounds[roundId] || {};
            const stName = stations[round.station_id]?.name || 'ไม่ทราบฐาน';
            
            // แก้ปัญหา Error .replace() ตรวจสอบก่อนว่ามี seat_id หรือไม่
            const seatName = b.seat_id ? String(b.seat_id).replace('seat_', '') : '<span class="text-danger">ไม่ระบุที่นั่ง</span>';
            const nationalId = b.national_id || 'ไม่มีข้อมูล';
            
            const isCheckedIn = (b.status === 'checked-in');

            tbody.innerHTML += `
                <tr>
                    <td class="small font-monospace">${bId}</td>
                    <td>${nationalId}</td>
                    <td>${stName} <br><small class="text-muted">${round.time_start || '--:--'}-${round.time_end || '--:--'}</small></td>
                    <td><span class="badge bg-dark">${seatName}</span></td>
                    <td>
                        <span class="badge ${isCheckedIn ? 'bg-success' : 'bg-warning text-dark'}">
                            ${isCheckedIn ? 'เช็คอินแล้ว' : 'จองแล้ว'}
                        </span>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-danger" onclick="deleteBooking('${bId}', '${roundId}', '${b.seat_id || ''}')">ลบ</button>
                    </td>
                </tr>
            `;
        }
    } catch (err) {
        console.error("Error loading bookings:", err);
        document.getElementById('bookings-table-body').innerHTML = `<tr><td colspan="6" class="text-center text-danger">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
}

async function deleteBooking(bookingId, roundId, seatId) {
    if(!confirm("ยืนยันการลบรายการนี้? ที่นั่งจะถูกคืนกลับสู่ระบบ")) return;

    try {
        // 1. ลบการจอง
        await db.ref(`bookings/${bookingId}`).remove();
        
        // 2. ตรวจสอบให้ชัวร์ว่ามี seatId จริงๆ ถึงจะคืนค่าที่นั่ง ป้องกันลบที่นั่งทั้งฐาน
        if (seatId && seatId !== 'undefined' && seatId !== 'null') {
            await db.ref(`seats/${roundId}/${seatId}`).update({ status: 'available', booked_by: null });
            // 3. คืนค่าที่นั่งว่าง +1
            await db.ref(`rounds/${roundId}/available_seats`).transaction(c => (c || 0) + 1);
        }
        
        alert("ลบและคืนที่นั่งสำเร็จ");
        loadAllBookings(); // โหลดตารางใหม่
    } catch (err) {
        alert("เกิดข้อผิดพลาด: " + err.message);
    }
}

// ==========================================
// 8. ระบบเช็คการเชื่อมต่อ และ Auto-Recovery
// ==========================================
db.ref('.info/connected').on('value', (snap) => {
    if (snap.val() === true) {
        console.log("🟢 กลับมาเชื่อมต่อกับระบบแล้ว");
        // ถ้าเชื่อมต่อกลับมาสำเร็จ และผู้ใช้อยู่หน้าเลือกรอบ ให้สั่งโหลดที่นั่งอีกครั้ง
        const currentRoundId = document.getElementById('round-select')?.value;
        if (currentRoundId && typeof loadSeats === 'function') {
            loadSeats();
        }
    } else {
        console.warn("🔴 ขาดการเชื่อมต่ออินเทอร์เน็ต หรือฐานข้อมูล");
    }
});

// เพิ่มฟังก์ชันนี้ลงไปในส่วนของ ระบบ Admin
function loadAdminStationsTable() {
    // โค้ดสำหรับดึงข้อมูล stations มาแสดงเป็นตาราง
    console.log("กำลังโหลดตารางข้อมูลฐานกิจกรรม...");
}
