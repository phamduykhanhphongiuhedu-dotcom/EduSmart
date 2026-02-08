const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const multer = require('multer'); 
const path = require('path');
const fs = require('fs');
// Import Models
const { sequelize, User, Course, Class, Enrollment, Attendance, Review, Recording, Op } = require('./models/database');

const app = express();
const port = 3000;

// --- 1. CONFIGURATION ---
const uploadDir = path.join(__dirname, 'public/uploads');
const recordDir = path.join(__dirname, 'public/recordings');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(recordDir)) fs.mkdirSync(recordDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'video_file') cb(null, 'public/recordings');
        else cb(null, 'public/uploads');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'edusmart_vip_secret', resave: false, saveUninitialized: true }));
app.use(express.static('public'));

// --- 2. HELPER FUNCTIONS ---

function toNonAccentVietnamese(str) {
    if (!str) return "";
    str = str.toLowerCase().replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a").replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e").replace(/ì|í|ị|ỉ|ĩ/g, "i").replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o").replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u").replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y").replace(/đ/g, "d").replace(/\s+/g, "");
    return str;
}

async function generateNextId(role) {
    const prefix = role === 'learner' ? 'HS' : 'GV';
    const lastUser = await User.findOne({ where: { role: role }, order: [['createdAt', 'DESC']] });
    if (!lastUser || !lastUser.custom_id) return prefix + '000001';
    const nextNum = parseInt(lastUser.custom_id.replace(prefix, '')) + 1;
    return prefix + String(nextNum).padStart(6, '0');
}

// [PARSER PRO] Chuẩn hóa lịch học (Hỗ trợ CN, Sunday, dấu cách)
function parseSchedule(str) {
    try {
        if (!str || typeof str !== 'string') return null;
        const parts = str.split('(');
        if (parts.length < 2) return null;

        const partDay = parts[0].toUpperCase().trim(); 
        const partTime = parts[1];

        const timeMatch = partTime.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        if (!timeMatch) return null;

        const days = [];
        const daysMap = { '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6 };
        
        for (const key in daysMap) {
            if (partDay.includes(key)) days.push(daysMap[key]);
        }
        // Fix CN: 0 là Chủ Nhật trong FullCalendar
        if (partDay.includes('CN') || partDay.includes('SUN') || partDay.includes('8')) {
            days.push(0); 
        }

        return { days: days, start: timeMatch[1], end: timeMatch[2] };
    } catch (e) { return null; }
}

// --- 3. MIDDLEWARE (SECURITY CORE) ---

// Hàm kiểm tra Auth chung, trả về JSON lỗi nếu gọi API mà mất session
const checkAuth = (role) => (req, res, next) => {
    if (!req.session.userId) {
        // Nếu là API request (AJAX/Fetch) -> Trả về JSON 401
        if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.method === 'POST') {
            return res.status(401).json({ success: false, message: 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.', redirect: '/login' });
        }
        // Nếu là truy cập trang thường -> Redirect
        return res.redirect('/login');
    }
    
    // Check Role
    if (role && req.session.role !== role) {
        if (req.session.role === 'teacher') return res.redirect('/teacher');
        return res.redirect('/learner');
    }
    next();
};

const requireTeacher = checkAuth('teacher');
const requireLearner = checkAuth('learner');
const requireLogin = checkAuth(null);

const requireVerified = async (req, res, next) => {
    const user = await User.findByPk(req.session.userId);
    if (!user || !user.is_verified) {
        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(403).json({ success: false, message: 'Tài khoản chưa xác thực KYC. Vui lòng gửi hồ sơ.' });
        }
        return res.send(`<script>alert('Vui lòng hoàn tất KYC để sử dụng tính năng này!'); window.location='/teacher';</script>`);
    }
    next();
};

// ==========================================
// 4. TEACHER CONTROLLER (QUẢN LÝ ĐÀO TẠO)
// ==========================================
app.get('/teacher', requireTeacher, async (req, res) => {
    try {
        const user = await User.findByPk(req.session.userId);
        const currentTab = req.query.tab || 'overview';

        // Lấy dữ liệu cơ sở
        const myCourses = await Course.findAll({ where: { teacher_id: user.id }, order: [['createdAt', 'DESC']] });
        const myCourseIds = myCourses.map(c => c.id);
        const allClassesRaw = await Class.findAll({ where: { course_id: myCourseIds } });

        // A. Dữ liệu cho tab Lớp học (Ghép tên khóa vào lớp)
        let allClassesWithCourseName = [];
        if (currentTab === 'classes' || currentTab === 'calendar') {
            allClassesWithCourseName = allClassesRaw.map(cl => {
                const course = myCourses.find(c => c.id === cl.course_id);
                return { ...cl.toJSON(), courseTitle: course ? course.title : 'Unknown' };
            });
        }

        // B. Calendar Logic
        let calendarEvents = [];
        const startToday = new Date(); startToday.setHours(0,0,0,0);
        const endToday = new Date(); endToday.setHours(23,59,59,999);

        const allClasses = await Promise.all(allClassesRaw.map(async (cl) => {
            const presentCount = await Attendance.count({ where: { class_id: cl.id, checkin_time: { [Op.between]: [startToday, endToday] } } });
            
            const sched = parseSchedule(cl.schedule);
            if (sched) {
                // Xử lý ngày kết thúc cho FullCalendar (exclusive)
                let endRecur = null;
                if (cl.end_date) { 
                    const d = new Date(cl.end_date); d.setDate(d.getDate() + 1); 
                    endRecur = d.toISOString().split('T')[0]; 
                }
                calendarEvents.push({
                    title: `${cl.name}`,
                    daysOfWeek: sched.days,
                    startTime: sched.start + ':00',
                    endTime: sched.end + ':00',
                    startRecur: cl.start_date,
                    endRecur: endRecur,
                    color: '#6366f1',
                    extendedProps: { className: cl.name, enrolled: cl.enrolled, capacity: cl.capacity, present: presentCount, meetingUrl: cl.meeting_url || '#' }
                });
            }
            return { ...cl.toJSON(), presentToday: presentCount };
        }));

        // C. Analytics & Finance & Students
        let chartData = { labels: [], revenue: [], attendance: [], pieLabels: [], pieData: [] };
        let transactionHistory = [];
        let classesWithStudents = []; // Dữ liệu Accordion
        let recordings = [];
        
        if (currentTab === 'overview') {
            // Biểu đồ 7 ngày
            for (let i = 6; i >= 0; i--) {
                const d = new Date(); d.setDate(d.getDate() - i);
                chartData.labels.push(new Date(d).toLocaleDateString('vi-VN', {day: '2-digit', month: '2-digit'}));
                const s = new Date(d.setHours(0,0,0,0)); const e = new Date(d.setHours(23,59,59,999));
                const rev = await Attendance.sum('tokens_deducted', { where: { course_id: myCourseIds, checkin_time: { [Op.between]: [s, e] } } });
                const att = await Attendance.count({ where: { course_id: myCourseIds, checkin_time: { [Op.between]: [s, e] } } });
                chartData.revenue.push(rev || 0); chartData.attendance.push(att || 0);
            }
            // Biểu đồ tròn
            const allEnrolls = await Enrollment.findAll({ where: { course_id: myCourseIds } });
            myCourses.forEach(c => {
                const count = allEnrolls.filter(e => e.course_id === c.id).length;
                if(count > 0) { chartData.pieLabels.push(c.title); chartData.pieData.push(count); }
            });
        }
        
        if (currentTab === 'finance') {
            const logs = await Attendance.findAll({ where: { course_id: myCourseIds }, order: [['checkin_time', 'DESC']], limit: 50 });
            transactionHistory = await Promise.all(logs.map(async (log) => {
                const st = await User.findByPk(log.student_id);
                const cl = await Class.findByPk(log.class_id);
                return { time: log.checkin_time, content: `Điểm danh: ${cl ? cl.name : 'Unknown'}`, student: st ? st.nickname : 'Unknown', amount: log.tokens_deducted };
            }));
        }

        if (currentTab === 'students') {
            // Group by Class cho Accordion
            classesWithStudents = await Promise.all(allClassesRaw.map(async (cl) => {
                const enrolls = await Enrollment.findAll({ where: { class_id: cl.id }, include: [{ model: User }] });
                const students = enrolls.map(e => ({ id: e.user.id, name: e.user.nickname, custom_id: e.user.custom_id, avatar: e.user.avatar, wallet: e.user.wallet_tokens, enrollDate: e.createdAt }));
                const course = myCourses.find(c => c.id === cl.course_id);
                return { classId: cl.id, className: cl.name, courseName: course ? course.title : 'Unknown', students: students };
            }));
        }

        if (currentTab === 'recordings') {
            recordings = await Recording.findAll({ where: { course_id: myCourseIds }, order: [['recorded_at', 'DESC']] });
            recordings = recordings.map(rec => { const c = myCourses.find(x => x.id === rec.course_id); return { ...rec.toJSON(), courseTitle: c ? c.title : 'N/A' }; });
        }

        const totalRevenue = await Attendance.sum('tokens_deducted', { where: { course_id: myCourseIds } }) || 0;
        const totalStudents = await Enrollment.count({ where: { course_id: myCourseIds } });
        const stats = { totalRevenue, totalStudents, totalCourses: myCourses.length, totalClasses: allClassesRaw.length };

        res.render('teacher', { 
            user, currentTab, myCourses, stats, allClasses, 
            allClassesWithCourseName, chartData, transactionHistory, 
            classesWithStudents, recordings, calendarEvents 
        });
    } catch (e) {
        console.error(e);
        res.status(500).send("Lỗi Server Teacher: " + e.message);
    }
});

// ==========================================
// 5. LEARNER CONTROLLER (TRẢI NGHIỆM HỌC TẬP)
// ==========================================
app.get('/learner', requireLearner, async (req, res) => {
    try {
        const user = await User.findByPk(req.session.userId);
        const currentTab = req.query.tab || 'dashboard'; // Mặc định là dashboard

        // 1. Lấy dữ liệu Enrollments (Join Course & Class)
        const enrollments = await Enrollment.findAll({ 
            where: { student_id: user.id },
            include: [{ model: Course }, { model: Class }] 
        });

        // 2. Build Calendar & My Courses & Upcoming Classes
        let calendarEvents = [];
        let myCourses = [];
        let upcomingClasses = [];
        const todayDay = new Date().getDay(); // 0-6

        myCourses = enrollments.map(e => {
            if (!e.course || !e.class) return null;

            // Parser Lịch
            const sched = parseSchedule(e.class.schedule);
            if (sched) {
                let endRecur = null;
                if (e.class.end_date) { const d = new Date(e.class.end_date); d.setDate(d.getDate() + 1); endRecur = d.toISOString().split('T')[0]; }
                
                // Add to Calendar
                calendarEvents.push({
                    title: `${e.class.name} (${e.course.title})`,
                    daysOfWeek: sched.days,
                    startTime: sched.start + ':00',
                    endTime: sched.end + ':00',
                    startRecur: e.class.start_date,
                    endRecur: endRecur,
                    color: '#10b981',
                    url: e.class.meeting_url
                });

                // Check Upcoming (Đơn giản: Trùng thứ là hiện)
                if (sched.days.includes(todayDay)) {
                    upcomingClasses.push({
                        courseName: e.course.title,
                        className: e.class.name,
                        time: `${sched.start} - ${sched.end}`,
                        link: e.class.meeting_url
                    });
                }
            }

            return {
                id: e.course.id,
                title: e.course.title,
                image_url: e.course.image_url,
                teacher_name: e.course.teacher_name,
                className: e.class.name,
                schedule: e.class.schedule,
                startDate: e.class.start_date,
                endDate: e.class.end_date,
                meetingUrl: e.class.meeting_url
            };
        }).filter(c => c !== null);

        // 3. Stats
        const totalSpent = await Attendance.sum('tokens_deducted', { where: { student_id: user.id } }) || 0;
        const classesAttended = await Attendance.count({ where: { student_id: user.id } });
        const activeCourses = myCourses.length;

        // 4. Marketplace (Gợi ý & Chọn lớp)
        let suggestedCourses = [];
        if (currentTab === 'market' || currentTab === 'courses') { // Load ở cả 2 tab để search
            const myCourseIds = enrollments.map(e => e.course_id);
            // Tìm khóa học chưa học
            const courses = await Course.findAll({
                where: { id: { [Op.notIn]: myCourseIds } },
                include: [{ model: Class }] // Eager load Classes
            });

            suggestedCourses = courses.map(c => {
                // Filter lớp còn chỗ
                const activeClasses = c.classes ? c.classes.filter(cl => cl.enrolled < cl.capacity) : [];
                return { 
                    ...c.toJSON(), 
                    availableClasses: activeClasses 
                };
            });
        }

        // 5. Wallet Log
        let historyLogs = [];
        if (currentTab === 'wallet') {
            historyLogs = await Attendance.findAll({ where: { student_id: user.id }, order: [['checkin_time', 'DESC']] });
        }

        res.render('learner', { 
            user, currentTab, myCourses, suggestedCourses, 
            historyLogs, calendarEvents, upcomingClasses,
            stats: { totalSpent, classesAttended, activeCourses }
        });

    } catch (e) {
        console.error("Learner Error:", e);
        res.status(500).send("Lỗi hệ thống Learner: " + e.message);
    }
});

// ==========================================
// 6. API ACTIONS (CRUD & BUSINESS LOGIC)
// ==========================================

// Teacher: Tạo Lớp Nhanh
app.post('/create-single-class', requireTeacher, async (req, res) => {
    try {
        const { course_id, name, schedule, start_date, end_date, capacity, meeting_url } = req.body;
        await Class.create({ name, schedule, start_date, end_date, capacity, meeting_url, course_id });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Teacher: Sửa Lớp Nhanh
app.post('/edit-single-class', requireTeacher, async (req, res) => {
    try {
        const { id, name, schedule, start_date, end_date, capacity, meeting_url } = req.body;
        await Class.update({ name, schedule, start_date, end_date, capacity, meeting_url }, { where: { id } });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Teacher: Tạo Khóa Học
app.post('/create-course', requireTeacher, requireVerified, async (req, res) => {
    try {
        const { title, description, price, image_url, classes } = req.body;
        const newCourse = await Course.create({ title, description, price_tokens: price, image_url, teacher_id: req.session.userId, teacher_name: (await User.findByPk(req.session.userId)).nickname });
        // (Optional) Tạo lớp ngay lúc tạo khóa nếu có data
        if (classes) {
            const classesData = JSON.parse(classes);
            for (const cls of classesData) {
                await Class.create({ ...cls, course_id: newCourse.id });
            }
        }
        res.send(`<script>alert('Tạo thành công!'); window.location='/teacher?tab=courses';</script>`);
    } catch(e) { res.send(e.message); }
});

// Teacher: Sửa Khóa Học (Chỉ sửa thông tin chung)
app.post('/edit-course', requireTeacher, requireVerified, async (req, res) => {
    try {
        const { id, title, price, description, image_url } = req.body;
        await Course.update({ title, price_tokens: price, description, image_url }, { where: { id, teacher_id: req.session.userId } });
        // Logic đồng bộ lớp ở đây (nếu dùng modal cũ) - nhưng ở bản Enterprise ta tách biệt nên API này chỉ sửa Course.
        res.send(`<script>alert('Cập nhật thành công!'); window.location='/teacher?tab=courses';</script>`);
    } catch(e) { res.send(e.message); }
});

// Teacher: Xóa Lớp (Check enrollment)
app.post('/delete-class', requireTeacher, async (req, res) => {
    try {
        const { classId } = req.body;
        const count = await Enrollment.count({ where: { class_id: classId } });
        if (count > 0) return res.status(400).json({ success: false, message: `Lớp đang có ${count} học viên. Không thể xóa!` });
        await Class.destroy({ where: { id: classId } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Teacher: Xóa Khóa (Check classes)
app.post('/delete-course', requireTeacher, async (req, res) => {
    try {
        const { courseId } = req.body;
        const count = await Class.count({ where: { course_id: courseId } });
        if (count > 0) return res.status(400).json({ success: false, message: `Còn ${count} lớp đang chạy. Vui lòng xóa hết lớp trước.` });
        await Course.destroy({ where: { id: courseId, teacher_id: req.session.userId } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Teacher: Điểm danh
// [FIX] Sửa lại trả về JSON thay vì script alert
app.post('/attendance', requireTeacher, async (req, res) => {
    try {
        const { learnerId, courseId } = req.body;
        const student = await User.findByPk(learnerId);
        
        // Tìm enrollment để lấy class_id
        const enrollment = await Enrollment.findOne({ 
            where: { student_id: learnerId, course_id: courseId },
            include: [Class]
        });
        
        if (!enrollment) return res.json({ success: false, message: 'Học viên chưa đăng ký!' });
        
        const course = await Course.findByPk(enrollment.course_id);
        const classObj = enrollment.class;
        const todayStr = new Date().toISOString().split('T')[0];

        // Validate ngày học
        if (classObj.start_date && todayStr < classObj.start_date) return res.json({ success: false, message: 'Lớp chưa khai giảng!' });
        if (classObj.end_date && todayStr > classObj.end_date) return res.json({ success: false, message: 'Lớp đã kết thúc!' });

        // Check đã điểm danh chưa
        const startOfDay = new Date(); startOfDay.setHours(0,0,0,0); 
        const endOfDay = new Date(); endOfDay.setHours(23,59,59,999);
        const existing = await Attendance.findOne({ 
            where: { 
                student_id: student.id, 
                course_id: course.id, 
                checkin_time: { [Op.between]: [startOfDay, endOfDay] } 
            } 
        });
        
        if (existing) return res.json({ success: false, message: 'Hôm nay đã điểm danh rồi!' });

        // Trừ tiền và lưu log
        if (student.wallet_tokens >= course.price_tokens) {
            await student.decrement('wallet_tokens', { by: course.price_tokens });
            await Attendance.create({ 
                student_id: student.id, 
                course_id: course.id, 
                class_id: classObj.id, 
                course_title: `${course.title} - ${classObj.name}`, 
                tokens_deducted: course.price_tokens, 
                checkin_time: new Date() 
            });
            // Trả về JSON thành công
            res.json({ success: true, message: '✅ Điểm danh thành công! Đã trừ Token.' });
        } else {
            res.json({ success: false, message: '❌ Học viên không đủ tiền!' });
        }
    } catch(e) { 
        res.status(500).json({ success: false, message: 'Lỗi server: ' + e.message }); 
    }
});

// Learner: Đăng ký lớp (Enroll)
app.post('/enroll', requireLearner, async (req, res) => {
    try {
        const { courseId, classId } = req.body;
        const student = await User.findByPk(req.session.userId);

        const existing = await Enrollment.findOne({ where: { student_id: student.id, course_id: courseId } });
        if (existing) return res.send(`<script>alert('Bạn đã đăng ký môn này rồi!'); window.history.back();</script>`);

        const classObj = await Class.findByPk(classId);
        if (!classObj) return res.send(`<script>alert('Lớp không tồn tại!'); window.history.back();</script>`);
        if (classObj.enrolled >= classObj.capacity) return res.send(`<script>alert('Lớp đã đầy!'); window.history.back();</script>`);

        await classObj.increment('enrolled');
        await Enrollment.create({ student_id: student.id, course_id: courseId, class_id: classId });
        res.send(`<script>alert('Đăng ký thành công!'); window.location='/learner?tab=courses';</script>`);
    } catch(e) { res.send(`<script>alert('Lỗi: ${e.message}'); window.history.back();</script>`); }
});
// [FIX] Thêm API lấy thông tin khóa học để sửa
app.get('/api/course/:id', requireTeacher, async (req, res) => {
    try {
        const course = await Course.findOne({
            where: { id: req.params.id, teacher_id: req.session.userId },
            include: [{ model: Class }] // Lấy kèm danh sách lớp
        });
        
        if (!course) {
            return res.status(404).json({ error: true, message: "Không tìm thấy khóa học" });
        }
        
        // Trả về JSON để teacher.ejs điền vào form
        res.json(course);
    } catch (e) {
        res.status(500).json({ error: true, message: e.message });
    }
});
// --- COMMON & AUTH ---
const kycUpload = upload.fields([{ name: 'student_card_image', maxCount: 1 }, { name: 'transcript_image', maxCount: 1 }, { name: 'degree_image', maxCount: 1 }]);
app.post('/submit-kyc', requireLogin, kycUpload, async (req, res) => { try { const user = await User.findByPk(req.session.userId); const { kyc_type, student_id, work_place, degree_number } = req.body; const files = req.files; let kycData = {}; let kycImages = {}; if (kyc_type === 'student_creator') { kycData = { type: 'Sinh viên', student_id }; if (files.student_card_image) kycImages.card = '/uploads/' + files.student_card_image[0].filename; if (files.transcript_image) kycImages.transcript = '/uploads/' + files.transcript_image[0].filename; } else { kycData = { type: 'Giảng viên', work_place, degree_number }; if (files.degree_image) kycImages.degree = '/uploads/' + files.degree_image[0].filename; } user.kyc_status = 'pending'; user.is_verified = false; user.kyc_type = kyc_type; user.kyc_data = JSON.stringify(kycData); user.kyc_images = JSON.stringify(kycImages); await user.save(); res.send(`<script>alert('Đã gửi hồ sơ!'); window.location='/teacher';</script>`); } catch (e) { res.send(`Lỗi: ${e.message}`); } });
app.get('/', (req,res)=>res.render('index', {courses:[], user:null}));
app.get('/login', (req,res)=>res.render('login'));
app.get('/register', (req,res)=>res.render('register'));
app.post('/login', async (req,res)=>{ const user = await User.findOne({where:{username:req.body.username, password:req.body.password}}); if(user){ req.session.userId=user.id; req.session.role=user.role; return res.redirect(user.role==='teacher'?'/teacher':'/learner'); } res.send(`<script>alert('Sai thông tin!'); window.location='/login';</script>`); });
app.post('/register', async (req,res)=>{ try { const {fullname, role, password} = req.body; const newId = await generateNextId(role); const email = `${newId}.${toNonAccentVietnamese(fullname)}.edu@edusmart`; await User.create({custom_id:newId, nickname:fullname, username:email, password, role, wallet_tokens:10}); res.render('register-success', {id:newId, email}); } catch(e){ res.send("Lỗi: "+e.message); } });
app.get('/logout', (req,res)=>{req.session.destroy(); res.redirect('/');});
app.get('/admin', async (req, res) => { const pendingUsers = await User.findAll({ where: { kyc_status: 'pending' } }); res.render('admin', { pendingUsers }); });
app.post('/admin/approve', async (req, res) => { const user = await User.findByPk(req.body.userId); if(user) { user.kyc_status='approved'; user.is_verified=true; await user.save(); } res.redirect('/admin'); });
app.post('/save-recording', requireTeacher, upload.single('video_file'), async (req, res) => { try { const { class_name } = req.body; const firstCourse = await Course.findOne({ where: { teacher_id: req.session.userId } }); await Recording.create({ course_id: firstCourse?firstCourse.id:0, class_name: class_name||'Online Class', video_path: '/recordings/'+req.file.filename, file_name: `Rec ${new Date().toLocaleString('vi-VN')}`, allow_download: false }); res.json({ success: true }); } catch(e) { res.status(500).json({ success: false }); } });
app.post('/toggle-download', requireTeacher, async (req, res) => { const { id } = req.body; const rec = await Recording.findByPk(id); if(rec) { rec.allow_download = !rec.allow_download; await rec.save(); } res.json({ success: true, newState: rec.allow_download }); });
app.post('/upload-avatar', requireLogin, upload.single('avatar'), async (req, res) => { try { if (!req.file) return res.status(400).json({ success: false }); const user = await User.findByPk(req.session.userId); user.avatar = '/uploads/' + req.file.filename; await user.save(); res.json({ success: true, newAvatar: user.avatar }); } catch (e) { res.status(500).json({ success: false }); } });

sequelize.sync().then(() => { app.listen(port, () => console.log(`Server chạy tại: http://localhost:${port}`)); });
