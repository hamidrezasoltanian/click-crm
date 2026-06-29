'use strict';
const { query } = require('./db');

// 30-second in-memory cache per entity type
const _cache = {};

async function getActiveWorkflow(entityType) {
  const now = Date.now();
  if (_cache[entityType] && now - _cache[entityType].ts < 30000) {
    return _cache[entityType].wf;
  }
  const r = await query(
    `SELECT definition FROM workflows WHERE entity_type=$1 AND is_active=true LIMIT 1`,
    [entityType]
  );
  const wf = r.rows[0] ? r.rows[0].definition : null;
  _cache[entityType] = { wf, ts: now };
  return wf;
}

function invalidateCache(entityType) {
  if (entityType) delete _cache[entityType];
  else Object.keys(_cache).forEach(k => delete _cache[k]);
}

// Returns true if the transition is allowed; falls back to true when no active workflow
function canTransition(wf, fromStatus, toStatus, userRole) {
  if (!wf || !wf.transitions || !wf.transitions.length) return true;
  const t = wf.transitions.find(x => x.from === fromStatus && x.to === toStatus);
  if (!t) return false;
  return roleAllowed(t.roles, userRole);
}

function roleAllowed(roles, userRole) {
  if (!roles || roles.length === 0 || roles.includes('all')) return true;
  if (roles.includes('manager') && userRole === 'manager') return true;
  if (roles.includes('sales') && userRole !== 'manager') return true;
  return false;
}

// Returns array of allowed target statuses from fromStatus for this user
function getAllowedTargets(wf, fromStatus, userRole) {
  if (!wf || !wf.transitions) return [];
  return wf.transitions
    .filter(t => t.from === fromStatus && roleAllowed(t.roles, userRole))
    .map(t => t.to);
}

module.exports = { getActiveWorkflow, invalidateCache, canTransition, getAllowedTargets };
