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

    db.ref(`seats/${roundId}`).on('value', (snap) => {
        const seats = snap.val();
        const map = document.getElementById('seat-map');
        map.innerHTML = '';
        selectedSeatId = null;

        for (let key in seats) {
            const s = seats[key];
            const div = document.createElement('div');
            div.className = `seat ${s.status === 'booked' ? 'booked' : ''}`;
            div.innerText = key.replace('seat_', '');
            
            if (s.status === 'available') {
                div.onclick = () => {
                    document.querySelectorAll('.seat').forEach(el => el.classList.remove('selected'));
                    div.classList.add('selected');
                    selectedSeatId = key;
                };
            }
            map.appendChild(div);
        }
    });
}

function confirmBooking() {
    const roundId = document.getElementById('round-select').value;
    const nationalId = document.getElementById('national-id').value;
    const name = document.getElementById('display-name').innerText;
    
    if(!roundId || !selectedSeatId || !nationalId) return alert("กรุณาเลือกข้อมูลให้ครบถ้วน");

    // ใช้ Transaction ป้องกันการจองชนกัน
    const seatRef = db.ref(`seats/${roundId}/${selectedSeatId}`);
    seatRef.transaction((currentData) => {
        if (currentData === null) return currentData;
        if (currentData.status === 'booked') {
            return; // ยกเลิกการทำรายการ ถ้าโดนจองไปแล้ว
        }
        currentData.status = 'booked';
        currentData.booked_by = nationalId;
        return currentData;
    }, (error, committed) => {
        if (error) {
            alert("เกิดข้อผิดพลาด: " + error);
        } else if (!committed) {
            alert("ขออภัย ที่นั่งนี้ถูกจองไปแล้ว กรุณาเลือกใหม่");
        } else {
            // บันทึกการจองสำเร็จ
            const bookingId = "BK-" + Date.now();
            db.ref(`bookings/${bookingId}`).set({
                national_id: nationalId,
                name: name,
                round_id: roundId,
                seat_id: selectedSeatId,
                staff_uid: currentUser.uid
            });
            
            // ลดจำนวนที่นั่งว่าง
            db.ref(`rounds/${roundId}/available_seats`).transaction(current => (current || 0) - 1);

            alert("จองสำเร็จ!");
            generateQR(bookingId);
            document.getElementById('user-data-form').style.display = 'none';
            document.getElementById('national-id').value = '';
        }
    });
}

function generateQR(text) {
    document.getElementById("qrcode-container").innerHTML = `<h3>QR Code สำหรับ Check-in</h3><div id="qr" style="display:flex; justify-content:center;"></div><p>รหัสอ้างอิง: ${text}</p>`;
    new QRCode(document.getElementById("qr"), { text: text, width: 200, height: 200 });
}
