/* ===== APEX-PROTECT-BEGIN (v5-module) ===== */
(() => {
  // ---------- Hard guard: never throw, never mutate legacy ----------
  const safe = (fn, fb=null) => { try { return fn(); } catch { return fb; } };
  const up   = s => String(s||'').toUpperCase();

  // ---------- Feature flag ----------
  const V5 = Object.freeze({
    enable: true,
    minTokenDiff: 3,
    cooldownLen: 8,       // recent history window for per-vector cooldown
    newWordBias: 0.6,     // chance to prefer new words when op/rel/dir not fixed
    maxReroll: 50
  });

  // ---------- Canonical maps (no new primitives) ----------
  const ACTION = Object.freeze({
    "pushes":"PUSH","pulls":"PULL","merges":"MERGE","splits":"SPLIT",
    "rotates":"ROTATE","oscillates":"OSCILLATE","transforms":"TRANSFORM","collides":"COLLIDE",
    // new
    "nudges":"PUSH","shoves":"PUSH","presses":"PUSH","launches":"PUSH","guides":"PUSH","steers":"PUSH",
    "drags":"PULL","lifts":"PUSH","drops":"PULL",
    "tilts":"ROTATE","spins":"ROTATE","orbits":"ROTATE",
    "aligns":"TRANSFORM","links":"MERGE","fuses":"MERGE","detaches":"SPLIT","breaks":"SPLIT",
    "brakes":"INHIBIT","slows":"DAMP","accelerates":"AMPLIFY","speeds":"AMPLIFY"
  });

  const REL = Object.freeze({
    "toward":"TOWARD","into":"INTO",
    // new
    "onto":"ONTO","across":"ACROSS","along":"ALONG","around":"AROUND","past":"PAST","through":"THROUGH",
    "between":"BETWEEN","beyond":"BEYOND","within":"WITHIN","near":"NEAR","beside":"BESIDE","against":"AGAINST",
    "alongside":"ALONGSIDE","out-of":"OUT_OF","up-to":"UP_TO","inside":"WITHIN","outside":"OUT_OF"
  });

  const DIR = Object.freeze({
    "upward":"UP","downward":"DOWN","leftward":"LEFT","rightward":"RIGHT",
    // new
    "forward":"FORWARD","backward":"BACK","inward":"IN","outward":"OUT",
    "clockwise":"CW","counterclockwise":"CCW","north":"NORTH","south":"SOUTH","east":"EAST","west":"WEST",
    "still":"ZERO"
  });

  // ---------- New surface pools (do NOT mutate legacy pools) ----------
  const NEW_ACTIONS = Object.freeze([
    "nudges","shoves","presses","launches","guides","steers","drags","lifts","drops",
    "tilts","spins","orbits","aligns","links","fuses","detaches","breaks","brakes","slows","accelerates","speeds"
  ]);
  const NEW_RELS = Object.freeze([
    "onto","across","along","around","past","through","between","beyond","within","near",
    "beside","against","alongside","out-of","up-to","inside","outside"
  ]);
  const NEW_DIRS = Object.freeze([
    "forward","backward","inward","outward","clockwise","counterclockwise","north","south","east","west","still"
  ]);

  // ---------- Helpers: merged “views” without touching originals ----------
  const uniq = arr => Array.from(new Set(arr));
  const viewOf = (legacy, add) => uniq([...(legacy||[]), ...add]);

  // Expose read-only views so generator can use them
  Object.defineProperties(window, {
    APEX_V5_VERB_VIEW: { get(){ return viewOf(safe(()=>window.DEFAULT_VERB_POOL,[]), NEW_ACTIONS); }},
    APEX_V5_REL_VIEW:  { get(){ return viewOf(safe(()=>window.DEFAULT_REL_POOL,[]),  NEW_RELS); }},
    APEX_V5_DIR_VIEW:  { get(){ return viewOf(safe(()=>window.DEFAULT_TAIL_POOL,[]), NEW_DIRS); }}
  });

  // ---------- Cooldowns to prevent repetition bias ----------
  const recent = { action: [], rel: [], dir: [] };
  const pushCD = (k,v)=>{
    const arr = recent[k]; arr.push(up(v));
    if (arr.length > V5.cooldownLen) arr.shift();
  };
  const inCD = (k,v)=> recent[k].includes(up(v));

  // ---------- Pickers with canonical + diversity + new-word bias ----------
  const pickFrom = (pool, prefCanon, mapper, key, biasNew, newPool) => {
    const P = pool.slice();
    // prefer matching canonical first
    let cand = prefCanon ? P.filter(w => mapper(w) === prefCanon) : P.slice();
    // bias toward new words when unconstrained
    if (!prefCanon && Math.random() < biasNew) {
      const newCand = newPool.filter(w => !inCD(key,w));
      if (newCand.length) cand = newCand;
    }
    // avoid recent cooldown
    let tries = 0, choice = null;
    while (tries++ < V5.maxReroll) {
      const src = cand.length ? cand : P;
      choice = src[Math.floor(Math.random()*src.length)];
      if (!inCD(key, choice)) break;
    }
    pushCD(key, choice);
    return choice;
  };

  // ---------- Safe attach once the generator exists ----------
  const attach = () => {
    const Gen = safe(()=>window.CanonicalPremiseGenerator);
    if (!V5.enable || !Gen) return false;

    // idempotence
    if (Gen.prototype.__apxV5__) return true;
    Gen.prototype.__apxV5__ = true;

    // resolve gates by level (non-invasive)
    const resolveGates = () => {
      const g = safe(()=>window.game) || {};
      const isBeginner = safe(()=>g.difficultyLevel) >= 1 && safe(()=>g.difficultyLevel) <= 5;
      // Use beginner gates if available; else fall back to views
      return {
        verbs: isBeginner ? safe(()=>g._beginnerGates?.verbs, null) : null,
        relations: isBeginner ? safe(()=>g._beginnerGates?.relations, null) : null,
        tails: isBeginner ? safe(()=>g._beginnerGates?.tails, null) : null
      };
    };

    // map helpers
    const mapAction = w => ACTION[String(w||'').toLowerCase()] || safe(()=>window.ACTION_MAP?.[w], null);
    const mapRel    = w => REL[String(w||'').toLowerCase()]    || safe(()=>window.CONNECTION_MAP?.[w], null);
    const mapDir    = w => DIR[String(w||'').toLowerCase()]    || safe(()=>window.DIRECTION_MAP?.[w], null);

    // core surface builder wrapper (non-destructive)
    const _buildSurface = Gen.prototype.buildSurface;
    Gen.prototype.buildSurface = function(canonPlan, extGates){
      const gates = extGates || resolveGates();
      const verbPool = (gates?.verbs && gates.verbs.length) ? gates.verbs : window.APEX_V5_VERB_VIEW;
      const relPool  = (gates?.relations && gates.relations.length) ? gates.relations : window.APEX_V5_REL_VIEW;
      const dirPool  = (gates?.tails && gates.tails.length) ? gates.tails : window.APEX_V5_DIR_VIEW;

      // target canon (may be null/partial)
      const targetOp  = safe(()=>canonPlan.op, null);
      const targetRel = safe(()=>canonPlan.rel, null);
      const targetDir = safe(()=>canonPlan.direction, null);

      let tries = 0, verb, rel, tail;

      while (tries++ < V5.maxReroll) {
        verb = pickFrom(verbPool, targetOp, mapAction, 'action', V5.newWordBias, NEW_ACTIONS);
        rel  = pickFrom(relPool,  targetRel, mapRel,    'rel',    V5.newWordBias, NEW_RELS);
        tail = pickFrom(dirPool,  targetDir, mapDir,    'dir',    V5.newWordBias, NEW_DIRS);

        const opOK  = !targetOp  || mapAction(verb) === targetOp;
        const relOK = !targetRel || mapRel(rel)     === targetRel;
        const dirOK = !targetDir || mapDir(tail)    === targetDir;

        if (opOK && relOK && dirOK) break;
      }

      // fallback to legacy if present
      if (_buildSurface) {
        const legacy = _buildSurface.call(this, canonPlan, gates);
        // Replace only the three surface tokens; keep subject/object from legacy
        legacy.verb     = verb || legacy.verb;
        legacy.relation = rel  || legacy.relation;
        legacy.tail     = tail || legacy.tail;
        return legacy;
      }

      // minimal shape if no legacy
      return { subject:"OBJECT", verb, object:"OBJECT", relation:rel, tail };
    };

    // diversity enforcement on finalize (block near-identical repeats)
    const _finalize = Gen.prototype.finalizeSurface;
    Gen.prototype.finalizeSurface = function(tokens){
      const tok = t => up(tokens[t]||'');
      // token diff vs. last surface
      this.__v5_last = this.__v5_last || null;
      const curr = [tok('subject'),tok('verb'),tok('object'),tok('relation'),tok('tail')].join(' ');
      const last = this.__v5_last;

      const tokenDiff = (a,b)=>{
        if (!a || !b) return 5;
        const A=a.split(/\s+/), B=b.split(/\s+/);
        let d=0; for (let i=0;i<5;i++) if (A[i]!==B[i]) d++;
        return d;
      };

      let out = tokens;
      if (last && tokenDiff(curr,last) < V5.minTokenDiff) {
        // force a re-pick of action/rel/dir once
        const canon = safe(()=>tokens.__canon, {});
        out = this.buildSurface(canon, resolveGates());
      }

      this.__v5_last = [up(out.subject||''),up(out.verb||''),up(out.object||''),up(out.relation||''),up(out.tail||'')].join(' ');

      return _finalize ? _finalize.call(this,out) : out;
    };

    return true;
  };

  // ---------- Attach when ready; poll if needed ----------
  const tryAttach = () => attach() || setTimeout(tryAttach, 50);
  tryAttach();
})();
/* ===== APEX-PROTECT-END (v5-module) ===== */
