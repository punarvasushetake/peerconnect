const express = require('express');
const { auth } = require('../../middleware/auth');
const peerController = require('../../controllers/peer.controller');

const router = express.Router();

router.get('/peer/requests', auth, peerController.listPeerRequests);
router.post('/peer/requests', auth, peerController.createPeerRequest);
router.get('/peer/matches', auth, peerController.getPeerMatches);
router.get('/peer/sessions', auth, peerController.listPeerSessions);
router.post('/peer/sessions', auth, peerController.requestPeerSession);
router.get('/peer/session-requests', auth, peerController.listIncomingSessionRequests);
router.post('/peer/sessions/:sessionId/accept', auth, peerController.acceptPeerSession);
router.post('/peer/sessions/:sessionId/decline', auth, peerController.declinePeerSession);
router.post('/peer/sessions/:sessionId/cancel', auth, peerController.cancelPeerSession);
router.post('/peer/sessions/:sessionId/end', auth, peerController.endPeerSession);

module.exports = router;
