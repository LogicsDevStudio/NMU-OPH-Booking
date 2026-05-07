// ==========================================
// 1. นำการตั้งค่ามาใส่ตรงนี้
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

// ==========================================
// 2. ระบบสลับหน้า (Router)
// ==========================================
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
    document.getElementById(pageId).style.display = 'block';
}

// ==========================================
// 3. ระบบ Authentication
// ==========================================
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        db.ref('users/' + user.uid).once('value').then((snapshot) => {
            const role = snapshot.val()?.role || 'staff';
            document.getElementById('nav-login').style.display = 'none';
            document.getElementById('nav-logout').style.display = 'inline-block';
            document.getElementById('nav-booking').style.display = 'inline-block';
            if (role === 'admin') document.getElementById('nav-admin').style.display = 'inline-block';
            loadStationsDropdown();
            showPage('booking-page');
        });
    } else {
        currentUser = null;
        document.getElementById('nav-login').style.display = 'inline-block';
        document.getElementById('nav-logout').style.display = 'none';
        document.getElementById('nav-booking').style.display = 'none';
        document.getElementById('nav-admin').style.display = 'none';
        showPage('public-page');
    }
});

function login() {
    auth.signInWithEmailAndPassword(document.getElementById('email').value, document.getElementById('password').value)
        .catch(err => alert("Login Failed: " + err.message));
}
function logout() { auth.signOut(); }

// ==========================================
// 4. หน้า Public (Realtime Dashboard)
// ==========================================
db.ref('rounds').on('value', async (snapshot) => {
    const rounds = snapshot.val();
    const dashboard = document.getElementById('dashboard-content');
    dashboard.innerHTML = '';
    if (!rounds) { dashboard.innerHTML = 'ไม่มีข้อมูลรอบกิจกรรม'; return; }

    const stationsSnap = await db.ref('stations').once('value');
    const stations = stationsSnap.val() || {};

    for (let key in rounds) {
        const r = rounds[key];
        const stationName = stations[r.station_id]?.name || 'ไม่ทราบชื่อฐาน';
        dashboard.innerHTML += `
            <div class="dashboard-item">
                <strong>${stationName}</strong> | เวลา: ${r.time_start} - ${r.time_end} <br>
                ที่นั่งว่าง: <span style="color: ${r.available_seats > 0 ? 'green' : 'red'}; font-weight:bold;">${r.available_seats} / ${r.total_seats}</span>
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
        // สร้างที่นั่งว่างไว้รอ
        let seats = {};
        for(let i=1; i<=total; i++) {
            seats[`seat_${i}`] = { status: 'available', booked_by: '' };
        }
        db.ref(`seats/${roundRef.key}`).set(seats);
        alert("เพิ่มรอบและสร้างที่นั่งสำเร็จ!");
    });
}

// โหลด Dropdown
function loadStationsDropdown() {
    db.ref('stations').once('value', (snap) => {
        const stations = snap.val();
        let html = '<option value="">-- เลือกฐานกิจกรรม --</option>';
        for (let key in stations) html += `<option value="${key}">${stations[key].name}</option>`;
        document.getElementById('admin-station-select').innerHTML = html;
        document.getElementById('station-select').innerHTML = html;
    });
}

function loadRoundsForBooking() {
    const stationId = document.getElementById('station-select').value;
    document.getElementById('round-select').innerHTML = '<option value="">-- เลือกรอบ --</option>';
    document.getElementById('seat-map').innerHTML = '';
    
    db.ref('rounds').orderByChild('station_id').equalTo(stationId).once('value', (snap) => {
        const rounds = snap.val();
        for (let key in rounds) {
            document.getElementById('round-select').innerHTML += `<option value="${key}">${rounds[key].time_start} - ${rounds[key].time_end}</option>`;
        }
    });
}

// ==========================================
// 6. ระบบ Staff (ดึงข้อมูล/จองที่นั่ง/QR Code)
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
            alert('ไม่พบข้อมูลใน Google Sheet ส่วนกลาง');
            document.getElementById('display-name').innerText = "";
        }
    } catch (err) { alert("เกิดข้อผิดพลาดในการดึงข้อมูล"); }
}

function loadSeats() {
    const roundId = document.getElementById('round-select').value;
    if(!roundId) return;

    // อ้างอิงไปยังที่นั่งของรอบนั้นๆ
    db.ref(`seats/${roundId}`).on('value', (snap) => {
        const seats = snap.val();
        const map = document.getElementById('seat-map');
        map.innerHTML = '';
        
        const now = Date.now();
        const TIMEOUT = 60000; // 1 นาที (ถ้าเลือกค้างไว้เกินนี้จะกลับเป็นสีเขียว)

        for (let key in seats) {
            const s = seats[key];
            const div = document.createElement('div');
            let statusClass = 'available';

            // 1. เช็คว่าจองแล้วหรือยัง (สีแดง)
            if (s.status === 'booked') {
                statusClass = 'booked';
            } 
            // 2. เช็คว่าแอดมินปิดการใช้งานหรือไม่ (สีเทา)
            else if (s.status === 'disabled') {
                statusClass = 'disabled';
            }
            // 3. เช็คว่ามีคนกำลังเลือกอยู่หรือไม่ (สีเหลือง)
            // เช็คว่ามีคนจอง UID ไว้ และเวลาที่เลือกยังไม่เกิน timeout
            else if (s.selecting_by && (now - s.selection_time < TIMEOUT)) {
                statusClass = 'selecting';
            }

            div.className = `seat ${statusClass}`;
            div.innerText = key.replace('seat_', '');
            
            // ตรรกะการคลิก
            div.onclick = () => {
                if (statusClass === 'available') {
                    selectSeat(roundId, key); // เราเลือกเอง
                } else if (statusClass === 'selecting' && s.selecting_by === currentUser.uid) {
                    deselectSeat(roundId, key); // เรากดยกเลิกการเลือกเอง
                } else if (statusClass === 'booked') {
                    alert("ที่นั่งนี้ถูกจองไปแล้ว");
                } else if (statusClass === 'selecting') {
                    alert("มีเจ้าหน้าที่ท่านอื่นกำลังทำรายการที่นั่งนี้");
                }
            };

            map.appendChild(div);
        }
    });
}

// เมื่อเจ้าหน้าที่คลิกที่นั่งเพื่อเลือก
function selectSeat(roundId, seatId) {
    // ก่อนจะเลือกที่นั่งใหม่ ต้องเคลียร์ที่นั่งเดิมที่เราเคยเลือกค้างไว้ก่อน (ถ้ามี)
    clearMyPreviousSelection(roundId);

    db.ref(`seats/${roundId}/${seatId}`).update({
        selecting_by: currentUser.uid,
        selection_time: Date.now()
    });
    selectedSeatId = seatId;
}

// กดยกเลิกที่เลือกอยู่
function deselectSeat(roundId, seatId) {
    db.ref(`seats/${roundId}/${seatId}`).update({
        selecting_by: null,
        selection_time: null
    });
    selectedSeatId = null;
}

// เคลียร์ที่นั่งเก่าที่เราเคยจิ้มไว้
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

function confirmBooking() {
    const roundId = document.getElementById('round-select').value;
    const nationalId = document.getElementById('national-id').value;
    
    if(!roundId || !selectedSeatId || !nationalId) return alert("กรุณาเลือกที่นั่งและใส่ข้อมูลผู้เข้าร่วม");

    const seatRef = db.ref(`seats/${roundId}/${selectedSeatId}`);
    
    seatRef.transaction((currentData) => {
        if (!currentData) return currentData;
        
        // เช็คอีกครั้งในระดับ Database ว่ามีคนชิงตัดหน้าจองไปหรือยัง
        if (currentData.status === 'booked') return; 

        currentData.status = 'booked';
        currentData.booked_by = nationalId;
        currentData.selecting_by = null; // ล้างสถานะสีเหลือง
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
            
            // ลดจำนวนที่ว่างในรอบนั้น
            db.ref(`rounds/${roundId}/available_seats`).transaction(c => (c || 0) - 1);

            alert("จองสำเร็จ!");
            generateQR(bookingId);
            selectedSeatId = null; 
        } else {
            alert("จองไม่สำเร็จ ที่นั่งอาจถูกจองไปแล้ว");
        }
    });
}

// ==========================================
// ส่วนจัดการ UI Bootstrap เพิ่มเติม
// ==========================================

// ฟังก์ชันปิด Offcanvas หลังจากคลิกเมนู
function closeOffcanvas() {
    const offcanvasEl = document.getElementById('sidebarMenu');
    const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasEl);
    if (offcanvasInstance) offcanvasInstance.hide();
}

// อัปเดต auth.onAuthStateChanged เพื่อสลับ Navbar UI
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        db.ref('users/' + user.uid).once('value').then((snapshot) => {
            const role = snapshot.val()?.role || 'staff';
            
            // สลับ UI บน Navbar
            document.getElementById('nav-login-btn').classList.add('d-none'); // ซ่อนปุ่ม Login
            document.getElementById('btn-sidebar-toggle').classList.remove('d-none'); // โชว์ปุ่ม Hamburger
            
            // แสดงเมนูใน Sidebar
            document.getElementById('nav-booking').style.display = 'block';
            document.getElementById('nav-logout').style.display = 'block';
            if (role === 'admin') document.getElementById('nav-admin').style.display = 'block';
            
            loadStationsDropdown();
            showPage('booking-page');
            closeOffcanvas(); // ปิด Sidebar อัตโนมัติหลัง login สำเร็จ
        });
    } else {
        currentUser = null;
        // คืนค่า UI กลับเป็น Public
        document.getElementById('nav-login-btn').classList.remove('d-none');
        document.getElementById('btn-sidebar-toggle').classList.add('d-none');
        
        document.getElementById('nav-booking').style.display = 'none';
        document.getElementById('nav-admin').style.display = 'none';
        document.getElementById('nav-logout').style.display = 'none';
        
        showPage('public-page');
    }
});

// ==========================================
// อัปเดตหน้า Dashboard ให้เป็น Grid Card
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
// อัปเดตการแสดงผล QR Code ให้เปิด Bootstrap Modal
// ==========================================
function generateQR(text) {
    document.getElementById("qrcode-container").innerHTML = "";
    document.getElementById("qr-ref").innerText = text;
    
    new QRCode(document.getElementById("qrcode-container"), { 
        text: text, 
        width: 150, 
        height: 150 
    });

    // เรียกใช้ Bootstrap Modal
    const qrModal = new bootstrap.Modal(document.getElementById('qrModal'));
    qrModal.show();
}
