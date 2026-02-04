const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const multer = require('multer'); 
const path = require('path');
const fs = require('fs');
const { sequelize, User, Course, Class, Enrollment, Attendance, Review, Op } = require('./models/database');

const app = express();
const port = 3000;

// --- CẤU HÌNH UPLOAD ---
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

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
const requireLogin = (req, res, next) => { if (!req.session.userId) return res.redirect('/login'); next(); };
const requireLearner = (req, res, next) => { if (!req.session.userId) return res.redirect('/login'); if (req.session.role !== 'learner') return res.redirect('/teacher'); next(); };
const requireTeacher = (req, res, next) => { if (!req.session.userId) return res.redirect('/login'); if (req.session.role !== 'teacher') return res.redirect('/learner'); next(); };

// --- ROUTES ---

// 1. DASHBOARD HỌC VIÊN
app.get('/learner', requireLearner, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    const currentTab = req.query.tab || 'overview';
    const enrollments = await Enrollment.findAll({ where: { student_id: user.id } });
    
    let myCourses = [];
    if (enrollments.length > 0) {
        myCourses = await Promise.all(enrollments.map(async (e) => {
            const c = await Course.findByPk(e.course_id);
            const cl = await Class.findByPk(e.class_id);
            if(!c) return null;
            return { ...c.toJSON(), className: cl ? cl.name : 'Chưa xếp lớp' };
        }));
        myCourses = myCourses.filter(c => c !== null);
    }

    let historyLogs = [];
    if (currentTab === 'history') historyLogs = await Attendance.findAll({ where: { student_id: user.id }, order: [['checkin_time', 'DESC']] });

    let suggestedCourses = [];
    if (currentTab === 'overview') {
        const myCourseIds = enrollments.map(e => e.course_id);
        const allCourses = await Course.findAll();
        const rawSuggestions = allCourses.filter(c => !myCourseIds.includes(c.id));
        suggestedCourses = await Promise.all(rawSuggestions.map(async (c) => {
            const revs = await Review.findAll({ where: { course_id: c.id } });
            let rating = 0;
            if (revs.length > 0) rating = (revs.reduce((sum, r) => sum + r.course_rating, 0) / revs.length).toFixed(1);
            const classes = await Class.findAll({ where: { course_id: c.id } });
            const availableClasses = classes.filter(cl => cl.enrolled < cl.capacity);
            if(availableClasses.length === 0) return null;
            return { ...c.toJSON(), rating, reviewCount: revs.length, classes: availableClasses };
        }));
        suggestedCourses = suggestedCourses.filter(c => c !== null);
    }
    res.render('learner', { user, currentTab, myCourses, suggestedCourses, historyLogs });
});

// 2. DASHBOARD GIÁO VIÊN (ĐÃ SỬA LOGIC LỌC LỚP)
app.get('/teacher', requireTeacher, async (req, res) => {
    const user = await User.findByPk(req.session.userId);
    const currentTab = req.query.tab || 'overview';
    const filterClassId = req.query.classId; // [MỚI] Lấy ID lớp cần lọc từ URL

    // Lấy khóa học
    const myCourses = await Course.findAll({ where: { teacher_id: user.id }, order: [['createdAt', 'DESC']] });
    const myCourseIds = myCourses.map(c => c.id);

    // Lấy tất cả lớp học (để hiển thị menu Lớp học và menu Filter)
    const teacherClasses = await Class.findAll({ where: { course_id: myCourseIds } });

    // [LOGIC LỌC HỌC VIÊN]
    let enrollmentQuery = { course_id: myCourseIds };
    
    // Nếu có chọn lọc theo lớp cụ thể
    if (filterClassId && filterClassId !== 'all') {
        enrollmentQuery.class_id = filterClassId;
    }

    const enrollments = await Enrollment.findAll({ where: enrollmentQuery });
    
    let myStudents = [];
    if (enrollments.length > 0) {
        const studentIds = enrollments.map(e => e.student_id);
        const studentsRaw = await User.findAll({ where: { id: studentIds } });
        
        myStudents = await Promise.all(studentsRaw.map(async (st) => {
            // Tìm enrollment tương ứng để lấy đúng lớp
            const enroll = enrollments.find(e => e.student_id === st.id);
            const course = myCourses.find(c => c.id === enroll.course_id);
            const cl = await Class.findByPk(enroll.class_id);
            
            const diffHours = Math.abs(new Date() - new Date(enroll.createdAt)) / 36e5;
            return { 
                ...st.toJSON(), 
                statusLabel: diffHours < 24 ? "Vừa đăng ký" : "Đang học", 
                courseName: course ? course.title : 'N/A',
                className: cl ? cl.name : 'Unknown'
            };
        }));
    }

    const reviews = await Review.findAll({ where: { course_id: myCourseIds } });
    let avgCourse = 0, avgTeacher = 0;
    if (reviews.length > 0) {
        avgCourse = (reviews.reduce((s, r) => s + r.course_rating, 0) / reviews.length).toFixed(1);
        avgTeacher = (reviews.reduce((s, r) => s + r.teacher_rating, 0) / reviews.length).toFixed(1);
    }

    const stats = {
        totalCourses: myCourses.length, 
        totalStudents: myStudents.length, // Số lượng này sẽ thay đổi theo bộ lọc
        totalRevenue: enrollments.reduce((sum, e) => {
            const c = myCourses.find(x => x.id === e.course_id);
            return sum + (c ? c.price_tokens : 0);
        }, 0),
        avgCourse, avgTeacher, reviewCount: reviews.length
    };

    res.render('teacher', { 
        user, currentTab, myCourses, myStudents, enrollments, stats, 
        allClasses: teacherClasses, // Truyền danh sách lớp sang view
        selectedClassId: filterClassId || 'all' // Để giữ trạng thái select
    });
});

// API & ACTIONS
app.post('/upload-avatar', requireLogin, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Lỗi file' });
        const user = await User.findByPk(req.session.userId);
        user.avatar = '/uploads/' + req.file.filename;
        await user.save();
        res.json({ success: true, newAvatar: user.avatar });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

const kycUpload = upload.fields([{ name: 'student_card_image', maxCount: 1 }, { name: 'transcript_image', maxCount: 1 }, { name: 'degree_image', maxCount: 1 }]);
app.post('/submit-kyc', requireLogin, kycUpload, async (req, res) => {
    try {
        const user = await User.findByPk(req.session.userId);
        const files = req.files;
        let kycImages = {};
        if(files.student_card_image) kycImages.card = '/uploads/' + files.student_card_image[0].filename;
        if(files.transcript_image) kycImages.transcript = '/uploads/' + files.transcript_image[0].filename;
        if(files.degree_image) kycImages.degree = '/uploads/' + files.degree_image[0].filename;
        
        user.kyc_status = 'pending'; user.is_verified = false; user.kyc_type = req.body.kyc_type;
        user.kyc_data = JSON.stringify(req.body); user.kyc_images = JSON.stringify(kycImages);
        await user.save();
        res.send(`<script>alert('Đã gửi hồ sơ!'); window.location='/teacher';</script>`);
    } catch (e) { res.send(`Lỗi: ${e.message}`); }
});

app.post('/create-course', requireTeacher, async (req, res) => {
    try {
        const { title, description, price, image_url, classes } = req.body;
        const newCourse = await Course.create({
            title, description, price_tokens: price, image_url,
            teacher_id: req.session.userId, teacher_name: (await User.findByPk(req.session.userId)).nickname
        });
        const classesData = JSON.parse(classes || '[]'); 
        if (classesData.length > 0) {
            for (const cls of classesData) {
                await Class.create({ name: cls.name, schedule: cls.schedule, capacity: cls.capacity, course_id: newCourse.id });
            }
        }
        res.send(`<script>alert('Tạo khóa học thành công!'); window.location='/teacher?tab=classes';</script>`);
    } catch(e) { res.send("Lỗi: " + e.message); }
});

app.post('/enroll', requireLearner, async (req, res) => {
    const { courseId, classId } = req.body;
    const student = await User.findByPk(req.session.userId);
    const existing = await Enrollment.findOne({ where: { student_id: student.id, course_id: courseId } });
    if (existing) return res.send(`<script>alert('Đã đăng ký rồi!'); window.history.back();</script>`);
    const classObj = await Class.findByPk(classId);
    if (classObj.enrolled >= classObj.capacity) return res.send(`<script>alert('Lớp đầy!'); window.history.back();</script>`);
    
    await classObj.increment('enrolled');
    await Enrollment.create({ student_id: student.id, course_id: courseId, class_id: classId });
    res.send(`<script>alert('Đăng ký thành công!'); window.location='/learner?tab=courses';</script>`);
});

app.post('/attendance', requireTeacher, async (req, res) => {
    const { learnerId } = req.body;
    const student = await User.findByPk(learnerId);
    const enrollment = await Enrollment.findOne({ where: { student_id: learnerId }, order: [['createdAt', 'DESC']] });
    if (!enrollment) return res.send(`<script>alert('Học viên không tồn tại!'); window.location='/teacher';</script>`);
    const course = await Course.findByPk(enrollment.course_id);
    const classObj = await Class.findByPk(enrollment.class_id);

    if (student.wallet_tokens >= course.price_tokens) {
        await student.decrement('wallet_tokens', { by: course.price_tokens });
        await Attendance.create({
            student_id: student.id, course_id: course.id, class_id: classObj.id,
            course_title: `${course.title} - ${classObj.name}`,
            tokens_deducted: course.price_tokens, checkin_time: new Date()
        });
        res.send(`<script>alert('✅ Điểm danh thành công!'); window.location='/teacher?tab=students';</script>`);
    } else {
        res.send(`<script>alert('Học viên thiếu tiền!'); window.location='/teacher?tab=students';</script>`);
    }
});

app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    const courses = await Course.findAll({ where: { title: { [Op.like]: `%${query}%` } } });
    res.json(courses);
});
app.get('/api/course/:id', async (req, res) => {
    const course = await Course.findByPk(req.params.id);
    if(!course) return res.status(404).json({error:"Not found"});
    const classes = await Class.findAll({ where: { course_id: course.id } });
    const reviews = await Review.findAll({ where: { course_id: course.id } });
    let avgCourse=0, avgTeacher=0;
    if(reviews.length>0){
        avgCourse = (reviews.reduce((s,r)=>s+r.course_rating,0)/reviews.length).toFixed(1);
        avgTeacher = (reviews.reduce((s,r)=>s+r.teacher_rating,0)/reviews.length).toFixed(1);
    }
    res.json({ ...course.toJSON(), stats: { avgCourse, avgTeacher }, classes: classes });
});
app.post('/submit-review', requireLearner, async (req, res) => {
    const { courseId, course_rating, teacher_rating, comment } = req.body;
    const student = await User.findByPk(req.session.userId);
    await Review.create({ student_id: student.id, student_name: student.nickname, course_id: courseId, course_rating, teacher_rating, comment });
    res.send(`<script>alert('Đánh giá thành công!'); window.location='/learner?tab=courses';</script>`);
});

app.get('/', (req,res)=>res.render('index', {courses:[], user:null}));
app.get('/login', (req,res)=>res.render('login'));
app.get('/register', (req,res)=>res.render('register'));
app.post('/login', async (req,res)=>{
    const user = await User.findOne({where:{username:req.body.username, password:req.body.password}});
    if(user){ req.session.userId=user.id; req.session.role=user.role; return res.redirect(user.role==='teacher'?'/teacher':'/learner'); }
    res.send(`<script>alert('Sai thông tin!'); window.location='/login';</script>`);
});
app.post('/register', async (req,res)=>{
    try {
        const {fullname, role, password} = req.body;
        const newId = await generateNextId(role);
        const email = `${newId}.${toNonAccentVietnamese(fullname)}.edu@edusmart`;
        await User.create({custom_id:newId, nickname:fullname, username:email, password, role, wallet_tokens:10});
        res.render('register-success', {id:newId, email});
    } catch(e){ res.send("Lỗi: "+e.message); }
});
app.get('/logout', (req,res)=>{req.session.destroy(); res.redirect('/');});
app.get('/admin', async (req, res) => { const pendingUsers = await User.findAll({ where: { kyc_status: 'pending' } }); res.render('admin', { pendingUsers }); });
app.post('/admin/approve', async (req, res) => { const user = await User.findByPk(req.body.userId); if(user) { user.kyc_status='approved'; user.is_verified=true; await user.save(); } res.redirect('/admin'); });

sequelize.sync().then(() => { app.listen(port, () => console.log(`Server chạy tại: http://localhost:${port}`)); });
