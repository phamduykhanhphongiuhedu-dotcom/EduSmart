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
    
    // KYC Fields
    kyc_status: { type: Sequelize.STRING, defaultValue: 'none' }, 
    kyc_type: { type: Sequelize.STRING }, 
    kyc_data: { type: Sequelize.TEXT }, 
    kyc_images: { type: Sequelize.TEXT }, 
    
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
    created_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW }
});

const Class = sequelize.define('class', {
    name: { type: Sequelize.STRING },
    schedule: { type: Sequelize.STRING }, // Format: "2,4,6 (08:00-10:00)"
    
    // Lộ trình học
    start_date: { type: Sequelize.DATEONLY }, 
    end_date: { type: Sequelize.DATEONLY },   
    
    capacity: { type: Sequelize.INTEGER, defaultValue: 30 },
    enrolled: { type: Sequelize.INTEGER, defaultValue: 0 },
    course_id: { type: Sequelize.INTEGER },
    meeting_url: { type: Sequelize.STRING }
});

const Enrollment = sequelize.define('enrollment', {
    student_id: { type: Sequelize.INTEGER },
    course_id: { type: Sequelize.INTEGER },
    class_id: { type: Sequelize.INTEGER } 
});

const Attendance = sequelize.define('attendance', {
    student_id: { type: Sequelize.INTEGER },
    course_id: { type: Sequelize.INTEGER },
    class_id: { type: Sequelize.INTEGER },
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

const Recording = sequelize.define('recording', {
    course_id: { type: Sequelize.INTEGER },
    class_id: { type: Sequelize.INTEGER },
    class_name: { type: Sequelize.STRING },
    video_path: { type: Sequelize.STRING },
    file_name: { type: Sequelize.STRING },
    recorded_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
    allow_download: { type: Sequelize.BOOLEAN, defaultValue: false }
});

// Associations
Course.hasMany(Class, { foreignKey: 'course_id' });
Class.belongsTo(Course, { foreignKey: 'course_id' });
Course.hasMany(Recording, { foreignKey: 'course_id' }); 

Enrollment.belongsTo(User, { foreignKey: 'student_id' });
Enrollment.belongsTo(Class, { foreignKey: 'class_id' });
Enrollment.belongsTo(Course, { foreignKey: 'course_id' });

module.exports = { sequelize, User, Course, Class, Enrollment, Attendance, Review, Recording, Op };
