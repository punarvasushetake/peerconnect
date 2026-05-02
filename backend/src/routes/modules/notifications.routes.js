const express = require('express');
const { auth } = require('../../middleware/auth');
const notificationsController = require('../../controllers/notifications.controller');

const router = express.Router();

router.get('/notifications', auth, notificationsController.listNotifications);
router.post('/notifications/:id/read', auth, notificationsController.markNotificationRead);
router.post('/notifications/read-all', auth, notificationsController.markAllNotificationsRead);

module.exports = router;
