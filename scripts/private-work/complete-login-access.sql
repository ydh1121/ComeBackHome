-- Run ONLY after the owner's existing bootstrap-hashes.sql succeeds.
-- Owner approved both accounts sharing the existing schedule workspace.
-- No credential changes and no case-admin consent. Safe to repeat this file alone.
INSERT INTO auth_workspace_grants(user_id,workspace,permission,approved_at)
SELECT id,'legacy','write',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM auth_users
WHERE login_id IN ('ydh1121','yvonne') AND disabled=0
  AND (SELECT COUNT(*) FROM auth_users u JOIN auth_credentials c ON c.user_id=u.id
       WHERE u.login_id IN ('ydh1121','yvonne') AND u.disabled=0)=2
  AND (SELECT COUNT(*) FROM case_profiles p JOIN auth_users u ON u.id=p.owner_id
       JOIN case_consents c ON c.case_id=p.id WHERE u.login_id='yvonne')=1
ON CONFLICT(user_id) DO UPDATE SET permission='write',approved_at=excluded.approved_at
WHERE auth_workspace_grants.permission<>'write';

INSERT INTO auth_audit(id,actor_id,action,outcome,target_id,created_at)
SELECT 'owner-shared-setup-' || u.id,NULL,'owner-approved-legacy-shared-access','applied',u.id,
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM auth_users u JOIN auth_workspace_grants g ON g.user_id=u.id
WHERE u.login_id IN ('ydh1121','yvonne') AND g.workspace='legacy' AND g.permission='write'
ON CONFLICT(id) DO NOTHING;

WITH expected(login_id) AS (VALUES ('ydh1121'),('yvonne'))
SELECT e.login_id AS account,
       CASE WHEN c.user_id IS NOT NULL THEN 'present' ELSE 'missing' END AS password_record,
       COALESCE(g.permission,'missing') AS shared_workspace_access,
       CASE WHEN u.disabled=0 AND c.user_id IS NOT NULL AND g.permission='write'
         AND EXISTS(SELECT 1 FROM case_profiles p JOIN auth_users owner ON owner.id=p.owner_id
           JOIN case_consents consent ON consent.case_id=p.id WHERE owner.login_id='yvonne')
         THEN 'READY_FOR_LOGIN' ELSE 'LOGIN_SETUP_INCOMPLETE' END AS result
FROM expected e
LEFT JOIN auth_users u ON u.login_id=e.login_id
LEFT JOIN auth_credentials c ON c.user_id=u.id
LEFT JOIN auth_workspace_grants g ON g.user_id=u.id AND g.workspace='legacy'
ORDER BY e.login_id;
