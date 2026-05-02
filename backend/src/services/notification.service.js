const { supabase } = require('../config/supabase');
const { getIO } = require('../socket');

const createNotification = async ({
  userId,
  type,
  title,
  message,
  entityType = null,
  entityId = null,
  metadata = {},
}) => {
  if (!userId || !title) return null;

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title,
      message,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to create notification:', error.message);
    return null;
  }

  const io = getIO();
  if (io) {
    io.to(`user:${userId}`).emit('notification:new', data);
  }

  return data;
};

module.exports = {
  createNotification,
};
