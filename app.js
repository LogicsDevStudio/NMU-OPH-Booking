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
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        db.ref('users/' + user.uid).once('value').then((snapshot) => {
            const role = snapshot.val()?.role || 'staff';
            
            // สลับ UI บน Navbar
            document.getElementById('nav-login-btn').classList.add('d-none');
            document.getElementById('btn-sidebar-toggle').classList.remove('d-none');
            
            // แสดงเมนูใน Sidebar
            document.getElementById('nav-booking').style.display = 'block';
            document.getElementById('nav-logout').style.display = 'block';
            if (role === 'admin') document.getElementById('nav-admin').style.display = 'block';
            
            loadStationsDropdown();
            showPage('booking-page');
            closeOffcanvas();
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
        let html = '<option value="">-- เลือกฐานกิจกรรม --</option>';
        for (let key in stations) html += `<option value="${key}">${stations[key].name}</option>`;
        document.getElementById('admin-station-select').innerHTML = html;
        document.getElementById('station-select').innerHTML = html;
    });
}

function loadRoundsForBooking() {
    const stationId = document.getElementById('station-select').value;
    document.getElementById('round-select').innerHTML = '<option value="">-- เลือกรอบ --</option>';
    document.getElementById('seat-map').innerHTML = '<div class="text-center text-muted w-100 py-5">กรุณาเลือกรอบกิจกรรมเพื่อดูที่นั่ง</div>';
    
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

    db.ref(`seats/${roundId}`).on('value', (snap) => {
        const seats = snap.val();
        const map = document.getElementById('seat-map');
        map.innerHTML = '';
        
        const now = Date.now();
        const TIMEOUT = 60000; // 1 นาที (60000 ms)

        for (let key in seats) {
            const s = seats[key];
            const div = document.createElement('div');
            let statusClass = 'available';

            // เช็คสถานะการจองตามลำดับ
            if (s.status === 'booked') {
                statusClass = 'booked';
            } 
            else if (s.status === 'disabled') {
                statusClass = 'disabled';
            }
            else if (s.selecting_by && (now - s.selection_time < TIMEOUT)) {
                // เช็คว่าเป็นตัวเราเลือกเอง หรือ คนอื่นเลือก
                if (s.selecting_by === currentUser.uid) {
                    statusClass = 'my-selection'; // สีฟ้า (เราเลือกเอง)
                } else {
                    statusClass = 'selecting'; // สีเหลือง (คนอื่นกำลังเลือก)
                }
            }

            div.className = `seat ${statusClass}`;
            div.innerText = key.replace('seat_', '');
            
            // ตรรกะเมื่อคลิกที่นั่ง
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
        }
    });
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
        if (!currentData) return currentData;
        
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
