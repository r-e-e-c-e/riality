-- Database rules that protect data even from direct SQL writes. Drizzle cannot
-- generate triggers, so they live in this hand-written migration. `db:push` skips
-- them; always use `db:migrate`.

-- Tenant tree: only groups can have children, firms cannot contain tenants, and
-- there are no cycles. Takes the same advisory lock (8147, 1) as the app's tenancy
-- administration, so tree changes happen one at a time.
CREATE FUNCTION enforce_tenant_tree() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(8147, 1);
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = NEW.parent_id AND kind = 'group') THEN
      RAISE EXCEPTION 'Only groups can contain tenants' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM tenant WHERE id = NEW.parent_id
        UNION
        SELECT t.id, t.parent_id FROM tenant t JOIN ancestors a ON t.id = a.parent_id
      ) SELECT 1 FROM ancestors WHERE id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Tenant hierarchy cannot contain cycles' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.kind = 'firm' AND EXISTS (SELECT 1 FROM tenant WHERE parent_id = NEW.id) THEN
    RAISE EXCEPTION 'Firms cannot contain tenants' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tenant_tree_guard BEFORE INSERT OR UPDATE ON tenant
FOR EACH ROW EXECUTE FUNCTION enforce_tenant_tree();
--> statement-breakpoint

-- Audit history is append-only.
CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON audit_event
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
--> statement-breakpoint

-- Clients belong to firms, never groups. FOR SHARE locks only the firm's row, so a
-- concurrent change of that tenant's kind waits for this insert (and vice versa).
CREATE FUNCTION enforce_client_firm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM tenant WHERE id = NEW.firm_id AND kind = 'firm' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clients must belong to a firm' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER client_firm_guard BEFORE INSERT OR UPDATE OF firm_id ON client
FOR EACH ROW EXECUTE FUNCTION enforce_client_firm();
--> statement-breakpoint

-- A firm that has clients cannot be turned into a group.
CREATE FUNCTION preserve_resource_firm_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> 'firm' AND EXISTS (SELECT 1 FROM client WHERE firm_id = NEW.id) THEN
    RAISE EXCEPTION 'A firm with clients cannot become a group' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER resource_firm_kind_guard BEFORE UPDATE OF kind ON tenant
FOR EACH ROW EXECUTE FUNCTION preserve_resource_firm_kind();
--> statement-breakpoint

-- Only the schema owner (the migration role) may create tables.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
