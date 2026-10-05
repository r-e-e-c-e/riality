-- Live updates: every audit event also sends a Postgres notification with IDs only
-- (never details). Notifications are sent when the transaction commits, so rolled-back
-- changes are never announced. The app listens on 'lines_changes' (change-feed.ts).
CREATE FUNCTION notify_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('lines_changes', json_build_object(
    'action', NEW.action,
    'tenantId', NEW.tenant_id,
    'engagementId', NEW.engagement_id,
    'subjectUserId', NEW.subject_user_id,
    'actorId', NEW.actor_id,
    'targetType', NEW.target_type,
    'targetId', NEW.target_id
  )::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_notify AFTER INSERT ON audit_event
FOR EACH ROW EXECUTE FUNCTION notify_audit_event();
