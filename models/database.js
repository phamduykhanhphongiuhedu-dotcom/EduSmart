const Sequelize = require('sequelize');
const { Op } = require('sequelize'); // QUAN TRỌNG: Import thêm Op để làm tính năng Tìm kiếm

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './edsmart.sqlite',
    logging: false
});

const User = sequelize.define('user', {
    custom_id: { type: Sequelize.STRING, unique: true },
    nickname: { type: Sequelize.STRING },
    username: { type: Sequelize.STRING, unique: true },
    password: { type: Sequelize.STRING },
    role: { type: Sequelize.STRING },
    wallet_tokens: { type: Sequelize.INTEGER, defaultValue: 10 }, // Mặc định tặng 10 Token
    
    // KYC Fields
    kyc_status: { type: Sequelize.STRING, defaultValue: 'none' },
    kyc_type: { type: Sequelize.STRING },
    kyc_data: { type: Sequelize.TEXT },
    is_verified: { type: Sequelize.BOOLEAN, defaultValue: false }
});

const Course = sequelize.define('course', {
    title: { type: Sequelize.STRING },
    description: { type: Sequelize.STRING },
    price_tokens: { type: Sequelize.INTEGER, defaultValue: 1 },
    image_url: { type: Sequelize.STRING },
    teacher_id: { type: Sequelize.INTEGER },
    teacher_name: { type: Sequelize.STRING },
    // MỚI: Thêm ngày khai giảng
    start_date: { type: Sequelize.DATE, defaultValue: Sequelize.NOW } 
});

const Enrollment = sequelize.define('enrollment', {
    student_id: { type: Sequelize.INTEGER },
    course_id: { type: Sequelize.INTEGER },
    status: { type: Sequelize.STRING, defaultValue: 'active' } 
});

const Attendance = sequelize.define('attendance', {
    student_id: { type: Sequelize.INTEGER },
    course_id: { type: Sequelize.INTEGER },
    course_title: { type: Sequelize.STRING },
    tokens_deducted: { type: Sequelize.INTEGER },
    checkin_time: { type: Sequelize.DATE, defaultValue: Sequelize.NOW }
});

// MỚI: Bảng Review tách 2 loại điểm
const Review = sequelize.define('review', {
    student_id: { type: Sequelize.INTEGER },
    student_name: { type: Sequelize.STRING },
    course_id: { type: Sequelize.INTEGER },
    
    course_rating: { type: Sequelize.INTEGER, defaultValue: 5 }, // Điểm môn học
    teacher_rating: { type: Sequelize.INTEGER, defaultValue: 5 }, // Điểm giáo viên
    
    comment: { type: Sequelize.STRING }
});

// Xuất khẩu Op ra để server.js dùng
module.exports = { sequelize, User, Course, Enrollment, Attendance, Review, Op };