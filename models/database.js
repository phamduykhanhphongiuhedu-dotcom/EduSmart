const Sequelize = require('sequelize');
const { Op } = require('sequelize');

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
    wallet_tokens: { type: Sequelize.INTEGER, defaultValue: 10 },
    kyc_status: { type: Sequelize.STRING, defaultValue: 'none' }, // none, pending, approved, rejected
    kyc_type: { type: Sequelize.STRING }, 
    kyc_data: { type: Sequelize.TEXT }, // Lưu JSON thông tin chữ
    kyc_images: { type: Sequelize.TEXT }, // [MỚI] Lưu JSON đường dẫn ảnh KYC
    is_verified: { type: Sequelize.BOOLEAN, defaultValue: false },
    avatar: { type: Sequelize.STRING, defaultValue: '/default-avatar.png' }
});

const Course = sequelize.define('course', {
    title: { type: Sequelize.STRING },
    description: { type: Sequelize.STRING },
    price_tokens: { type: Sequelize.INTEGER, defaultValue: 1 },
    image_url: { type: Sequelize.STRING },
    teacher_id: { type: Sequelize.INTEGER },
    teacher_name: { type: Sequelize.STRING },
    start_date: { type: Sequelize.DATE, defaultValue: Sequelize.NOW }
});

// [MỚI] Bảng Lớp học
const Class = sequelize.define('class', {
    name: { type: Sequelize.STRING }, // VD: Lớp Sáng 2-4-6 (8h-10h)
    schedule: { type: Sequelize.STRING }, // Chi tiết giờ
    capacity: { type: Sequelize.INTEGER, defaultValue: 30 }, // Số lượng tối đa
    enrolled: { type: Sequelize.INTEGER, defaultValue: 0 }, // Số lượng đã đăng ký
    course_id: { type: Sequelize.INTEGER }
});

// [CẬP NHẬT] Đăng ký phải gắn với 1 Lớp cụ thể
const Enrollment = sequelize.define('enrollment', {
    student_id: { type: Sequelize.INTEGER },
    course_id: { type: Sequelize.INTEGER },
    class_id: { type: Sequelize.INTEGER } // [MỚI] Học viên thuộc lớp nào
});

const Attendance = sequelize.define('attendance', {
    student_id: { type: Sequelize.INTEGER },
    course_id: { type: Sequelize.INTEGER },
    class_id: { type: Sequelize.INTEGER }, // [MỚI]
    course_title: { type: Sequelize.STRING },
    tokens_deducted: { type: Sequelize.INTEGER },
    checkin_time: { type: Sequelize.DATE, defaultValue: Sequelize.NOW }
});

const Review = sequelize.define('review', {
    student_id: { type: Sequelize.INTEGER },
    student_name: { type: Sequelize.STRING },
    course_id: { type: Sequelize.INTEGER },
    course_rating: { type: Sequelize.INTEGER, defaultValue: 5 },
    teacher_rating: { type: Sequelize.INTEGER, defaultValue: 5 },
    comment: { type: Sequelize.STRING }
});

// Thiết lập quan hệ
Course.hasMany(Class, { foreignKey: 'course_id' });
Class.belongsTo(Course, { foreignKey: 'course_id' });

module.exports = { sequelize, User, Course, Class, Enrollment, Attendance, Review, Op };
