const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { sequelize, User, Course, Enrollment, Attendance, Review, Op } = require('./models/database');

const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'edusmart_secret_key', resave: false, saveUninitialized: true }));
app.use(express.static('public'));

// --- HELPER ---
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
const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

// --- ROUTES ---

// 1. DASHBOARD HỌC VIÊN
app.get('/learner', requireLogin, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    const currentTab = req.query.tab || 'overview';
    
    // Lấy danh sách ID các khóa học ĐÃ MUA
    const enrollments = await Enrollment.findAll({ where: { student_id: user.id } });
    const myCourseIds = enrollments.map(e => e.course_id);
    
    let myCourses = [];
    if (myCourseIds.length > 0) {
        myCourses = await Course.findAll({ where: { id: myCourseIds } });
    }

    let historyLogs = [];
    if (currentTab === 'history') {
        historyLogs = await Attendance.findAll({ where: { student_id: user.id }, order: [['checkin_time', 'DESC']] });
    }

    // Lấy danh sách GỢI Ý (Trừ các khóa đã mua)
    let suggestedCourses = [];
    if (currentTab === 'overview') {
        const allCourses = await Course.findAll();
        // Chỉ lấy khóa chưa mua để gợi ý
        const rawSuggestions = allCourses.filter(c => !myCourseIds.includes(c.id));
        
        suggestedCourses = await Promise.all(rawSuggestions.map(async (c) => {
            const revs = await Review.findAll({ where: { course_id: c.id } });
            let rating = 0;
            if (revs.length > 0) rating = (revs.reduce((sum, r) => sum + r.course_rating, 0) / revs.length).toFixed(1);
            return { ...c.toJSON(), rating, reviewCount: revs.length };
        }));
    }

    res.render('learner', { user, currentTab, myCourses, suggestedCourses, historyLogs });
});

// 2. DASHBOARD GIÁO VIÊN
app.get('/teacher', requireLogin, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    const currentTab = req.query.tab || 'overview';

    // Lấy khóa học của CHÍNH GIÁO VIÊN NÀY
    const myCourses = await Course.findAll({ 
        where: { teacher_id: user.id },
        order: [['createdAt', 'DESC']]
    });
    const myCourseIds = myCourses.map(c => c.id);

    // Lấy danh sách đăng ký CHỈ CỦA CÁC KHÓA HỌC NÀY
    const enrollments = await Enrollment.findAll({ where: { course_id: myCourseIds } });
    const studentIds = enrollments.map(e => e.student_id);
    
    let myStudents = [];
    if (studentIds.length > 0) {
        const studentsRaw = await User.findAll({ where: { id: studentIds } });
        myStudents = studentsRaw.map(st => {
            const enroll = enrollments.find(e => e.student_id === st.id);
            const course = myCourses.find(c => c.id === enroll.course_id);
            const diffHours = Math.abs(new Date() - new Date(enroll.createdAt)) / 36e5;
            return { ...st.toJSON(), statusLabel: diffHours < 24 ? "Vừa đăng ký" : "Đang học", courseName: course ? course.title : 'N/A' };
        });
    }

    const reviews = await Review.findAll({ where: { course_id: myCourseIds } });
    let avgCourse = 0, avgTeacher = 0;
    if (reviews.length > 0) {
        avgCourse = (reviews.reduce((sum, r) => sum + r.course_rating, 0) / reviews.length).toFixed(1);
        avgTeacher = (reviews.reduce((sum, r) => sum + r.teacher_rating, 0) / reviews.length).toFixed(1);
    }

    const stats = {
        totalCourses: myCourses.length,
        totalStudents: myStudents.length, // Số lượng chuẩn xác
        totalRevenue: enrollments.reduce((sum, e) => {
            const c = myCourses.find(x => x.id === e.course_id);
            return sum + (c ? c.price_tokens : 0);
        }, 0), 
        avgCourse, avgTeacher, reviewCount: reviews.length
    };

    res.render('teacher', { user, currentTab, myCourses, myStudents, enrollments, stats });
});

// --- API & ACTIONS ---
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    const courses = await Course.findAll({ where: { title: { [Op.like]: `%${query}%` } } });
    res.json(courses);
});

app.get('/api/course/:id', async (req, res) => {
    const courseId = req.params.id;
    const course = await Course.findByPk(courseId);
    if (!course) return res.status(404).json({ error: "Not found" });
    const reviews = await Review.findAll({ where: { course_id: courseId } });
    let avgCourse = 0, avgTeacher = 0;
    if (reviews.length > 0) {
        avgCourse = (reviews.reduce((sum, r) => sum + r.course_rating, 0) / reviews.length).toFixed(1);
        avgTeacher = (reviews.reduce((sum, r) => sum + r.teacher_rating, 0) / reviews.length).toFixed(1);
    }
    res.json({ ...course.toJSON(), stats: { avgCourse, avgTeacher, totalReviews: reviews.length } });
});

app.post('/register', async (req, res) => {
    try {
        const { fullname, role, password } = req.body;
        const newId = await generateNextId(role);
        const email = `${newId}.${toNonAccentVietnamese(fullname)}.edu@edusmart`;
        await User.create({ custom_id: newId, nickname: fullname, username: email, password, role, wallet_tokens: 10 });
        res.render('register-success', { id: newId, email });
    } catch (e) { res.send("Lỗi: " + e.message); }
});

app.post('/enroll', requireLogin, async (req, res) => {
    const { courseId } = req.body;
    const student = await User.findByPk(req.session.userId);
    const course = await Course.findByPk(courseId);
    const existing = await Enrollment.findOne({ where: { student_id: student.id, course_id: course.id } });
    if (existing) return res.send(`<script>alert('Bạn đã đăng ký khóa này rồi!'); window.history.back();</script>`);
    await Enrollment.create({ student_id: student.id, course_id: course.id });
    res.send(`<script>alert('Đăng ký thành công! (Token sẽ chỉ bị trừ khi điểm danh)'); window.location='/learner?tab=courses';</script>`);
});



app.post('/attendance', requireLogin, async (req, res) => {
    const { learnerId } = req.body;
    const student = await User.findByPk(learnerId);
    
    const enrollment = await Enrollment.findOne({ 
        where: { student_id: learnerId },
        order: [['createdAt', 'DESC']] 
    });

    if (!enrollment) return res.send(`<script>alert('Học viên này chưa đăng ký khóa học nào!'); window.location='/teacher?tab=students';</script>`);
    
    const course = await Course.findByPk(enrollment.course_id);

    if (student.wallet_tokens >= course.price_tokens) {
        await student.decrement('wallet_tokens', { by: course.price_tokens });
        await Attendance.create({
            student_id: student.id,
            course_id: course.id,
            course_title: course.title,
            tokens_deducted: course.price_tokens, // Lưu lại giá tại thời điểm điểm danh
            checkin_time: new Date()
        });

        res.send(`<script>alert('✅ Điểm danh thành công!\\nĐã trừ ${course.price_tokens} Token của học viên.'); window.location='/teacher?tab=students';</script>`);
    } else {
        const missing = course.price_tokens - student.wallet_tokens;
        res.send(`<script>alert('❌ Không thể điểm danh!\\nHọc phí buổi này là ${course.price_tokens} Token.\\nHọc viên chỉ còn ${student.wallet_tokens} Token (Thiếu ${missing}).\\nYêu cầu học viên nạp thêm!'); window.location='/teacher?tab=students';</script>`);
    }
});

app.post('/submit-review', requireLogin, async (req, res) => {
    const { courseId, course_rating, teacher_rating, comment } = req.body;
    const student = await User.findByPk(req.session.userId);
    const existing = await Review.findOne({ where: { student_id: student.id, course_id: courseId } });
    if (existing) { existing.course_rating = course_rating; existing.teacher_rating = teacher_rating; existing.comment = comment; await existing.save(); }
    else { await Review.create({ student_id: student.id, student_name: student.nickname, course_id: courseId, course_rating, teacher_rating, comment }); }
    res.send(`<script>alert('Đánh giá thành công!'); window.location='/learner?tab=courses';</script>`);
});

// (Giữ các route Login, Create Course, KYC, Admin như cũ)
app.get('/', async (req, res) => { res.render('index', { courses: [], user: null }); });
app.get('/register', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    const user = await User.findOne({ where: { username: req.body.username, password: req.body.password } });
    if (user) { req.session.userId = user.id; req.session.role = user.role; return res.redirect(user.role === 'teacher' ? '/teacher' : '/learner'); }
    res.send(`<script>alert('Sai pass!'); window.location='/login';</script>`);
});
app.post('/create-course', requireLogin, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    await Course.create({ title: req.body.title, description: req.body.description, price_tokens: req.body.price, image_url: req.body.image_url, teacher_id: user.id, teacher_name: user.nickname });
    res.send(`<script>alert('Tạo khóa học thành công!'); window.location='/teacher';</script>`);
});
app.post('/submit-kyc', requireLogin, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    user.kyc_status = 'pending'; user.is_verified = false; user.kyc_type = req.body.kyc_type; user.kyc_data = JSON.stringify(req.body); await user.save();
    res.send(`<script>alert('Đã gửi KYC!'); window.location='/teacher';</script>`);
});
app.get('/admin', async (req, res) => { const pendingUsers = await User.findAll({ where: { kyc_status: 'pending' } }); res.render('admin', { pendingUsers }); });
app.post('/admin/approve', async (req, res) => { const user = await User.findByPk(req.body.userId); user.kyc_status = 'approved'; user.is_verified = true; await user.save(); res.redirect('/admin'); });
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

sequelize.sync().then(() => { app.listen(port, () => console.log(`Server chạy tại: http://localhost:${port}`)); });