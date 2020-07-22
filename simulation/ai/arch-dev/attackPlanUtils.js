/** Attack Plan Utilities */

ARCH.AttackPlan.prototype.getName = function () {
	return this.name;
};

ARCH.AttackPlan.prototype.getType = function () {
	return this.type;
};

ARCH.AttackPlan.prototype.isStarted = function () {
	return this.state !== "unexecuted" && this.state !== "completing";
};

ARCH.AttackPlan.prototype.isPaused = function () {
	return this.paused ? this.paused : false;
};

ARCH.AttackPlan.prototype.setPaused = function (boolValue) {
	this.paused = boolValue;
};

/**
 * Returns true if the attack can be executed at the current time
 * Basically it checks we have enough units.
 */
ARCH.AttackPlan.prototype.canStart = function () {
	return true;
};

ARCH.AttackPlan.prototype.mustStart = function () {
	if (this.isPaused())
		return false;

	return this.unitCollection.hasEntities();
};

ARCH.AttackPlan.prototype.forceStart = function () {
	this.forced = true;
};

ARCH.AttackPlan.prototype.isAvailableUnit = function (gameState, ent, expectedHealthLevel = 0.8) {
	if (!ent.position()) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Unit position is invalid.");
/// DEBUG
		return false;
	} else if (ent.healthLevel() < expectedHealthLevel) { // TODO: Check this.overseas necessity
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Unit health is low.");
/// DEBUG
		return false;
	} else if (ent.getMetadata(PlayerID, "plan") !== undefined && ent.getMetadata(PlayerID, "plan") !== -1 || gameState.ai.HQ.victoryManager.criticalEnts.has(ent.id())) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Unit has been already assigned in a plan.");
/// DEBUG
		return false;
	} else if (ent.getMetadata(PlayerID, "transport") !== undefined || ent.getMetadata(PlayerID, "transporter") !== undefined) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Unit is waiting transport.");
/// DEBUG
		return false;
	}
	return true;
};

ARCH.AttackPlan.prototype.countDestroyers = function (gameState) {
	this.destroyerCount = 0;
	for (let ent of this.unitCollection.values()) {
		if (gameState.ai.HQ.attackManager.isDestroyer(ent)) {
			this.destroyerCount++;
		}
	}
};

/** Reassign one (at each turn) Cav unit to fasten raid preparation. */
ARCH.AttackPlan.prototype.reassignCavUnit = function (gameState) {
	for (let ent of this.unitCollection.values()) {
		if (!ent.position() || ent.getMetadata(PlayerID, "transport") !== undefined)
			continue;
		if (ent.hasClass("Champion") || !ent.hasClass("Cavalry") || !ent.hasClass("CitizenSoldier"))
			continue;
		let raid = gameState.ai.HQ.attackManager.getAttackInPreparation("Raid");
		ent.setMetadata(PlayerID, "plan", raid.name);
		this.unitCollection.updateEnt(ent);
		raid.unitCollection.updateEnt(ent);
		return;
	}
};

ARCH.AttackPlan.prototype.chooseTarget = function (gameState) {
	if (this.targetPlayer === undefined) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "The target enemy player is undefined, trying to find an enemy!");
/// DEBUG
		this.targetPlayer = gameState.ai.HQ.attackManager.getEnemyPlayer(gameState, this);
		if (this.targetPlayer === undefined) {
/// DEBUG
			gameState.ai.logger.push("DEBUG", "AttackManager", "Couldn't find any enemies! Terminating chooseTarget method.");
/// DEBUG
			return false;
		}
	}

	if (!this.rallyPoint) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Rally point is undefined! Terminating chooseTarget method.");
/// DEBUG
		return false;
	}

	this.target = this.getNearestTarget(gameState, this.rallyPoint);
	if (!this.target) {
		if (this.uniqueTargetId) {
/// DEBUG
			gameState.ai.logger.push("DEBUG", "AttackManager", "Unique Target ID is undefined! Terminating chooseTarget method.");
/// DEBUG
			return false;
		}

		// may-be all our previous enemy target (if not recomputed here) have been destroyed ?
		this.targetPlayer = gameState.ai.HQ.attackManager.getEnemyPlayer(gameState, this);
		if (this.targetPlayer !== undefined)
			this.target = this.getNearestTarget(gameState, this.rallyPoint);
		if (!this.target) {
/// DEBUG
			gameState.ai.logger.push("DEBUG", "AttackManager", "Target is invalid! Terminating chooseTarget method.");
/// DEBUG
			return false;
		}
	}
	this.targetPos = this.target.position();

	if (this.type === "Naval") {
		return true;
	}

	// redefine a new rally point for this target if we have a base on the same land
	// find a new one on the pseudo-nearest base (dist weighted by the size of the island)
	let targetIndex = ARCH.getLandAccess(gameState, this.target);
	let rallyIndex = gameState.ai.accessibility.getAccessValue(this.rallyPoint);
	if (targetIndex !== rallyIndex) {
		let distminSame = Math.min();
		let rallySame;
		let distminDiff = Math.min();
		let rallyDiff;
		for (let base of gameState.ai.HQ.baseManagers) {
			let anchor = base.anchor;
			if (!anchor || !anchor.position())
				continue;
			let dist = API3.SquareVectorDistance(anchor.position(), this.targetPos);
			if (base.accessIndex === targetIndex) {
				if (dist >= distminSame)
					continue;
				distminSame = dist;
				rallySame = anchor.position();
			} else {
				dist /= Math.sqrt(gameState.ai.accessibility.regionSize[base.accessIndex]);
				if (dist >= distminDiff)
					continue;
				distminDiff = dist;
				rallyDiff = anchor.position();
			}
		}

		if (rallySame) {
			this.rallyPoint = rallySame;
			this.overseas = 0;
		} else if (rallyDiff) {
			rallyIndex = gameState.ai.accessibility.getAccessValue(rallyDiff);
			this.rallyPoint = rallyDiff;
			let sea = gameState.ai.HQ.getSeaBetweenIndices(gameState, rallyIndex, targetIndex);
			if (sea) {
				this.overseas = sea;
				gameState.ai.HQ.navalManager.setMinimalTransportShips(gameState, this.overseas, this.shipsRequired);
			} else {
/// DEBUG
				gameState.ai.logger.push("BUG", "AttackManager", this.type + " " + this.name + " has an inaccessible target" +
					" with indices " + rallyIndex + " " + targetIndex + " from " + this.target.templateName() + ". Terminating chooseTarget method.");
/// DEBUG
				return false;
			}
		}
	} else if (this.overseas)
		this.overseas = 0;

	return true;
};
/*
 * sameLand true means that we look for a target for which we do not need to take a transport
 */
ARCH.AttackPlan.prototype.getNearestTarget = function (gameState, position, sameLand) {
	this.isBlocked = false;
	// Temporary variables needed by isValidTarget
	this.gameState = gameState;
	this.sameLand = sameLand && sameLand > 1 ? sameLand : false;

	let targets;
	if (this.uniqueTargetId) {
		targets = new API3.EntityCollection(gameState.sharedScript);
		let ent = gameState.getEntityById(this.uniqueTargetId);
		if (ent) {
			targets.addEnt(ent);
		}
	} else if (this.type === "Naval") {
		targets = this.navalTargetFinder(gameState, this.targetPlayer);
	} else if (this.type === "Raid") {
		targets = this.raidTargetFinder(gameState);
		if (!targets.hasEntities()) {
			targets = this.defaultTargetFinder(gameState, this.targetPlayer);
		}
	} else if (this.type === "Rush" || this.type === "Check") {
		targets = this.rushTargetFinder(gameState, this.targetPlayer);
		if (!targets.hasEntities() && (this.hasSiegeUnits() || this.forced))
			targets = this.defaultTargetFinder(gameState, this.targetPlayer);
	} else {
		targets = this.defaultTargetFinder(gameState, this.targetPlayer);
	}
	if (!targets || !targets.hasEntities()) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Target is invalid or has no entities! Terminating getNearestTarget method.");
/// DEBUG
		return undefined;
	}


	// picking the nearest target
	let target;
	let minDist = Math.min();
	for (let ent of targets.values()) {
		if (this.targetPlayer === 0 && gameState.getVictoryConditions().has("capture_the_relic") &&
			(!ent.hasClass("Relic") || gameState.ai.HQ.victoryManager.targetedGaiaRelics.has(ent.id())))
			continue;
		// Do not bother with some pointless targets
		if (!this.isValidTarget(ent))
			continue;
		let dist = API3.SquareVectorDistance(ent.position(), position);
		// In normal attacks, disfavor fields
		if (this.type !== "Rush" && this.type !== "Raid" && ent.hasClass("Field"))
			dist += 100000;
		if (dist < minDist) {
			minDist = dist;
			target = ent;
		}
	}
	if (!target) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Couldn't find close targets to attack! Terminating getNearestTarget method.");
/// DEBUG
		return undefined;
	}

	// Check that we can reach this target
	target = this.checkTargetObstruction(gameState, target, position);

	if (!target) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Cannot reach the target! Terminating getNearestTarget method.");
/// DEBUG
		return undefined;
	}

	if (this.targetPlayer === 0 && gameState.getVictoryConditions().has("capture_the_relic") && target.hasClass("Relic"))
		gameState.ai.HQ.victoryManager.targetedGaiaRelics.set(target.id(), [this.name]);
	// Rushes can change their enemy target if nothing found with the preferred enemy
	// Obstruction also can change the enemy target
	this.targetPlayer = target.owner();
	return target;
};

/**
 * Default target finder aims for conquest critical targets
 * We must apply the *same* selection (isValidTarget) as done in getNearestTarget
 */
ARCH.AttackPlan.prototype.defaultTargetFinder = function (gameState, playerEnemy) {
	let targets = new API3.EntityCollection(gameState.sharedScript);

	if (gameState.getVictoryConditions().has("wonder"))
		for (let ent of gameState.getEnemyStructures(playerEnemy).filter(API3.Filters.byClass("Wonder")).values())
			targets.addEnt(ent);
	if (gameState.getVictoryConditions().has("regicide"))
		for (let ent of gameState.getEnemyUnits(playerEnemy).filter(API3.Filters.byClass("Hero")).values())
			targets.addEnt(ent);
	if (gameState.getVictoryConditions().has("capture_the_relic"))
		for (let ent of gameState.updatingGlobalCollection("allRelics", API3.Filters.byClass("Relic")).filter(relic => relic.owner() === playerEnemy).values())
			targets.addEnt(ent);
	targets = targets.filter(this.isValidTarget, this);
	if (targets.hasEntities())
		return targets;

	let validTargets = gameState.getEntities(playerEnemy).filter(this.isValidTarget, this);

	let acceptableTargets = {
		"Structure": ["CivCentre", "ConquestCritical", "Town", "Village"],
		"Unit": ["Hero", "Siege", "Champion", "Cavalry", "Ranged", "Infantry", "FemaleCitizen"]
	};
	for (let targetList in acceptableTargets) {
		for (let type in acceptableTargets[targetList]) {
			let target = validTargets.filter(API3.Filters.byClass(acceptableTargets[targetList][type]));
			if (target.hasEntities()) {
				return target;
			}
		}
	}

	targets = gameState.getEntities(playerEnemy).filter(API3.Filters.byClass("ConquestCritical")).filter(API3.Filters.not(API3.Filters.byClass("Ship")));
	return targets;
};

ARCH.AttackPlan.prototype.navalTargetFinder = function (gameState, playerEnemy) {
	let validTargets = gameState.getEntities(playerEnemy).filter(this.isValidTarget, this);

	let acceptableTargets = {
		"Ship": ["Warship", "Trader", "FishingBoat", "Ship"],
		"Structure": ["Shipyard", "Dock"],
		"Unit": ["Hero", "Siege", "Champion", "Infantry", "FemaleCitizen", "Cavalry", "Ranged"]
	};
	for (let targetList in acceptableTargets) {
		for (let type in acceptableTargets[targetList]) {
			let target = validTargets.filter(API3.Filters.byClass(acceptableTargets[targetList][type]));
			if (target.hasEntities()) {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "AttackManager", "A naval target with a type " + type + " was found.");
/// DEBUG
				return target;
			}
		}
	}
	return false;
};

ARCH.AttackPlan.prototype.isValidTarget = function (ent) {
	if (!ent.position())
		return false;
	if (this.type === "Naval") {
		return true;
	}
	if (this.sameLand && ARCH.getLandAccess(this.gameState, ent) !== this.sameLand)
		return false;
	return !ent.decaying() || ent.getDefaultArrow() || ent.isGarrisonHolder() && ent.garrisoned().length;
};

/** Rush target finder aims at isolated non-defended buildings */
ARCH.AttackPlan.prototype.rushTargetFinder = function (gameState, playerEnemy) {
	let targets = new API3.EntityCollection(gameState.sharedScript);
	let buildings;
	if (playerEnemy !== undefined)
		buildings = gameState.getEnemyStructures(playerEnemy).toEntityArray();
	else
		buildings = gameState.getEnemyStructures().toEntityArray();
	if (!buildings.length)
		return targets;

	this.position = this.unitCollection.getCentrePosition();
	if (!this.position)
		this.position = this.rallyPoint;

	let target;
	let minDist = Math.min();
	for (let building of buildings) {
		if (building.owner() === 0)
			continue;
		if (building.hasDefensiveFire())
			continue;
		if (!this.isValidTarget(building))
			continue;
		let pos = building.position();
		let defended = false;
		for (let defence of buildings) {
			if (!defence.hasDefensiveFire())
				continue;
			let dist = API3.SquareVectorDistance(pos, defence.position());
			if (dist < 6400)   // TODO check on defence range rather than this fixed 80*80
			{
				defended = true;
				break;
			}
		}
		if (defended)
			continue;
		let dist = API3.SquareVectorDistance(pos, this.position);
		if (dist > minDist)
			continue;
		minDist = dist;
		target = building;
	}
	if (target)
		targets.addEnt(target);

	if (!targets.hasEntities() && this.type === "Rush" && playerEnemy)
		targets = this.rushTargetFinder(gameState);

	return targets;
};


/**
 * Check that we can have a path to this target
 * otherwise we may be blocked by walls and try to react accordingly
 * This is done only when attacker and target are on the same land
 */
ARCH.AttackPlan.prototype.checkTargetObstruction = function (gameState, target, position) {
	if (ARCH.getLandAccess(gameState, target) !== gameState.ai.accessibility.getAccessValue(position))
		return target;

	let targetPos = target.position();
	let startPos = {"x": position[0], "y": position[1]};
	let endPos = {"x": targetPos[0], "y": targetPos[1]};
	let blocker;
	let path = Engine.ComputePath(startPos, endPos, gameState.getPassabilityClassMask("default"));
	if (!path.length)
		return undefined;

	let pathPos = [path[0].x, path[0].y];
	let dist = API3.VectorDistance(pathPos, targetPos);
	let radius = target.obstructionRadius().max;
	for (let struct of gameState.getEnemyStructures().values()) {
		if (!struct.position() || !struct.get("Obstruction") || struct.hasClass("Field"))
			continue;
		// we consider that we can reach the target, but nonetheless check that we did not cross any enemy gate
		if (dist < radius + 10 && !struct.hasClass("Gates"))
			continue;
		// Check that we are really blocked by this structure, i.e. advancing by 1+0.8(clearance)m
		// in the target direction would bring us inside its obstruction.
		let structPos = struct.position();
		let x = pathPos[0] - structPos[0] + 1.8 * (targetPos[0] - pathPos[0]) / dist;
		let y = pathPos[1] - structPos[1] + 1.8 * (targetPos[1] - pathPos[1]) / dist;

		if (struct.get("Obstruction/Static")) {
			if (!struct.angle())
				continue;
			let angle = struct.angle();
			let width = +struct.get("Obstruction/Static/@width");
			let depth = +struct.get("Obstruction/Static/@depth");
			let cosa = Math.cos(angle);
			let sina = Math.sin(angle);
			let u = x * cosa - y * sina;
			let v = x * sina + y * cosa;
			if (Math.abs(u) < width / 2 && Math.abs(v) < depth / 2) {
				blocker = struct;
				break;
			}
		} else if (struct.get("Obstruction/Obstructions")) {
			if (!struct.angle())
				continue;
			let angle = struct.angle();
			let width = +struct.get("Obstruction/Obstructions/Door/@width");
			let depth = +struct.get("Obstruction/Obstructions/Door/@depth");
			let doorHalfWidth = width / 2;
			width += +struct.get("Obstruction/Obstructions/Left/@width");
			depth = Math.max(depth, +struct.get("Obstruction/Obstructions/Left/@depth"));
			width += +struct.get("Obstruction/Obstructions/Right/@width");
			depth = Math.max(depth, +struct.get("Obstruction/Obstructions/Right/@depth"));
			let cosa = Math.cos(angle);
			let sina = Math.sin(angle);
			let u = x * cosa - y * sina;
			let v = x * sina + y * cosa;
			if (Math.abs(u) < width / 2 && Math.abs(v) < depth / 2) {
				blocker = struct;
				break;
			}
			// check that the path does not cross this gate (could happen if not locked)
			for (let i = 1; i < path.length; ++i) {
				let u1 = (path[i - 1].x - structPos[0]) * cosa - (path[i - 1].y - structPos[1]) * sina;
				let v1 = (path[i - 1].x - structPos[0]) * sina + (path[i - 1].y - structPos[1]) * cosa;
				let u2 = (path[i].x - structPos[0]) * cosa - (path[i].y - structPos[1]) * sina;
				let v2 = (path[i].x - structPos[0]) * sina + (path[i].y - structPos[1]) * cosa;
				if (v1 * v2 < 0) {
					let u0 = (u1 * v2 - u2 * v1) / (v2 - v1);
					if (Math.abs(u0) > doorHalfWidth)
						continue;
					blocker = struct;
					break;
				}
			}
			if (blocker)
				break;
		} else if (struct.get("Obstruction/Unit")) {
			let r = +this.get("Obstruction/Unit/@radius");
			if (x * x + y * y < r * r) {
				blocker = struct;
				break;
			}
		}
	}

	if (blocker && blocker.hasClass("StoneWall")) {
		/*		if (this.hasSiegeUnits())
				{ */
		this.isBlocked = true;
		return blocker;
		/*		}
				return undefined; */
	} else if (blocker) {
		this.isBlocked = true;
		return blocker;
	}

	return target;
};

ARCH.AttackPlan.prototype.getPathToTarget = function (gameState, fixedRallyPoint = false) {
	let startAccess = gameState.ai.accessibility.getAccessValue(this.rallyPoint);
	let endAccess = ARCH.getLandAccess(gameState, this.target);
	if (this.type !== "Naval" && startAccess !== endAccess)
		return false;
///
	Engine.ProfileStart("AI Compute path");
///
	let startPos = {"x": this.rallyPoint[0], "y": this.rallyPoint[1]};
	let endPos = {"x": this.targetPos[0], "y": this.targetPos[1]};
	let path = Engine.ComputePath(startPos, endPos, gameState.getPassabilityClassMask("large"));
	this.path = [];
	this.path.push(this.targetPos);
	for (let p in path)
		this.path.push([path[p].x, path[p].y]);
	this.path.push(this.rallyPoint);
	this.path.reverse();
	// Change the rally point to something useful
	if (!fixedRallyPoint)
		this.setRallyPoint(gameState);
///
	Engine.ProfileStop();
///
	return true;
};

/** Set rally point at the border of our territory */
ARCH.AttackPlan.prototype.setRallyPoint = function (gameState) {
	for (let i = 0; i < this.path.length; ++i) {
		if (gameState.ai.HQ.territoryMap.getOwner(this.path[i]) === PlayerID)
			continue;

		if (i === 0)
			this.rallyPoint = this.path[0];
		else if (i > 1 && gameState.ai.HQ.isDangerousLocation(gameState, this.path[i - 1], 20)) {
			this.rallyPoint = this.path[i - 2];
			this.path.splice(0, i - 2);
		} else {
			this.rallyPoint = this.path[i - 1];
			this.path.splice(0, i - 1);
		}
		break;
	}
};

ARCH.AttackPlan.prototype.UpdateTransporting = function (gameState, events) {
	let done = true;
	for (let ent of this.unitCollection.values()) {
///
		if (ent.getMetadata(PlayerID, "transport") !== undefined)
			Engine.PostCommand(PlayerID, {"type": "set-shading-color", "entities": [ent.id()], "rgb": [2, 2, 0]});
		else
			Engine.PostCommand(PlayerID, {"type": "set-shading-color", "entities": [ent.id()], "rgb": [1, 1, 1]});
///
		if (!done)
			continue;
		if (ent.getMetadata(PlayerID, "transport") !== undefined)
			done = false;
	}

	if (done) {
		this.state = "arrived";
		return;
	}

	// if we are attacked while waiting the rest of the army, retaliate
	for (let evt of events.Attacked) {
		if (!this.unitCollection.hasEntId(evt.target))
			continue;
		let attacker = gameState.getEntityById(evt.attacker);
		if (!attacker || !gameState.getEntityById(evt.target))
			continue;
		for (let ent of this.unitCollection.values()) {
			if (ent.getMetadata(PlayerID, "transport") !== undefined)
				continue;
			if (!ent.isIdle())
				continue;
			ent.attack(attacker.id(), ARCH.allowCapture(gameState, ent, attacker));
		}
		break;
	}
};

/**
 * @return {boolean}
 */
ARCH.AttackPlan.prototype.UpdateWalking = function (gameState, events) {
	// we're marching towards the target
	// Let's check if any of our unit has been attacked.
	// In case yes, we'll determine if we're simply off against an enemy army, a lone unit/building
	// or if we reached the enemy base. Different plans may react differently.
	let attackedNB = 0;
	let attackedUnitNB = 0;
	for (let evt of events.Attacked) {
		if (!this.unitCollection.hasEntId(evt.target))
			continue;
		let attacker = gameState.getEntityById(evt.attacker);
		if (attacker && (attacker.owner() !== 0 || this.targetPlayer === 0)) {
			attackedNB++;
			if (attacker.hasClass("Unit"))
				attackedUnitNB++;
		}
	}

	if (!this.position) {
		return;
	}
	// Are we arrived at destination ?
	if (attackedNB > 1 && (attackedUnitNB || this.hasSiegeUnits())) {
		if (gameState.ai.HQ.territoryMap.getOwner(this.position) === this.targetPlayer || attackedNB > 3) {
			this.state = "arrived";
			return true;
		}
	}

	if (gameState.ai.playedTurn - this.lastCheckedTurn > 5) {
		// basically haven't moved an inch: very likely stuck)
		if (API3.SquareVectorDistance(this.position, this.lastCheckedPosition) < 10 && this.path.length > 0) {
			// check for stuck siege units
			let farthest = 0;
			let farthestEnt;
			for (let ent of this.unitCollection.filter(API3.Filters.byClass("Siege")).values()) {
				let dist = API3.SquareVectorDistance(ent.position(), this.position);
				if (dist < farthest)
					continue;
				farthest = dist;
				farthestEnt = ent;
			}
			if (farthestEnt)
				farthestEnt.destroy();
		}
		this.lastCheckedPosition = this.position;
		this.lastCheckedTurn = gameState.ai.playedTurn;
	}

	if (this.lastPosition && API3.SquareVectorDistance(this.position, this.lastPosition) < 16 && this.path.length > 0) {
/// DEBUG
		if (!this.path[0][0] || !this.path[0][1]) {
			gameState.ai.logger.push("BUG", "AttackManager", "Problem with path generation: " + uneval(this.path));
		}
/// DEBUG
		// We're stuck, presumably. Check if there are no walls just close to us.
		for (let ent of gameState.getEnemyStructures().filter(API3.Filters.byClass(["Palisade", "StoneWall"])).values()) {
			if (API3.SquareVectorDistance(this.position, ent.position()) > 800)
				continue;
			let enemyClass = ent.hasClass("StoneWall") ? "StoneWall" : "Palisade";
			// there are walls, so check if we can attack
			if (this.unitCollection.filter(API3.Filters.byCanAttackClass(enemyClass)).hasEntities()) {
/// DEBUG
				gameState.ai.logger.push("INFO", "AttackManager", "We have encountered with the walls when conducting " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
				this.state = "arrived";
				return true;
			}
			// Abort the plan
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", "We have encountered with the walls. Terminating " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
			return false;
		}

		// this.unitCollection.move(this.path[0][0], this.path[0][1]);
		this.unitCollection.moveIndiv(this.path[0][0], this.path[0][1]);
	}

	// check if our units are close enough from the next waypoint.
	if (API3.SquareVectorDistance(this.position, this.targetPos) < 10000) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "We have arrived to the destination of " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
		this.state = "arrived";
		return true;
	} else if (this.path.length && API3.SquareVectorDistance(this.position, this.path[0]) < 1600) {
		this.path.shift();
		if (this.path.length)
			this.unitCollection.moveToRange(this.path[0][0], this.path[0][1], 0, 15);
		else {
/// DEBUG
			gameState.ai.logger.push("DEBUG", "AttackManager", "We have arrived to the destination of " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
			this.state = "arrived";
			return true;
		}
	}
	return true;
};

/*
 * @return {boolean}
 */
ARCH.AttackPlan.prototype.UpdateTarget = function (gameState) {
	// First update the target position in case it's a unit (and check if it has garrisoned)
	if (this.target && this.target.hasClass("Unit")) {
		this.targetPos = this.target.position();
		if (!this.targetPos) {
			let holder = ARCH.getHolder(gameState, this.target);
			if (holder && gameState.isPlayerEnemy(holder.owner())) {
				this.target = holder;
				this.targetPos = holder.position();
			} else
				this.target = undefined;
		}
	}
	// Then update the target if needed:
	if (this.targetPlayer === undefined || !gameState.isPlayerEnemy(this.targetPlayer)) {
		this.targetPlayer = gameState.ai.HQ.attackManager.getEnemyPlayer(gameState, this);
		if (this.targetPlayer === undefined) {
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", "The target enemy player is undefined! Terminating UpdateTarget method.");
/// DEBUG
			return false;
		}


		if (this.target && this.target.owner() !== this.targetPlayer)
			this.target = undefined;
	}
	if (this.target && this.target.owner() === 0 && this.targetPlayer !== 0)  // this enemy has resigned
		this.target = undefined;

	if (!this.target || !gameState.getEntityById(this.target.id())) {
/// DEBUG
		gameState.ai.logger.push("WARNING", "AttackManager", "Seems like our target for " + this.type + " attack, plan: " + this.name + " has been destroyed or captured. Switching to a new target.");
/// DEBUG
		let accessIndex = this.getAttackAccess(gameState);
		this.target = this.getNearestTarget(gameState, this.position, accessIndex);
		if (!this.target) {
			if (this.uniqueTargetId) {
/// DEBUG
				gameState.ai.logger.push("BUG", "AttackManager", "The target is undefined, however the target has a unique ID! Terminating UpdateTarget method.");
/// DEBUG
				return false;
			}

			// Check if we could help any current attack
			let attackManager = gameState.ai.HQ.attackManager;
			for (let attackType in attackManager.startedAttacks) {
				for (let attack of attackManager.startedAttacks[attackType]) {
					if (attack.name === this.name)
						continue;
					if (!attack.target || !gameState.getEntityById(attack.target.id()) ||
						!gameState.isPlayerEnemy(attack.target.owner()))
						continue;
					if (accessIndex !== ARCH.getLandAccess(gameState, attack.target))
						continue;
					if (attack.target.owner() === 0 && attack.targetPlayer !== 0)	// looks like it has resigned
						continue;
					if (!gameState.isPlayerEnemy(attack.targetPlayer))
						continue;
					this.target = attack.target;
					this.targetPlayer = attack.targetPlayer;
					this.targetPos = this.target.position();
					return true;
				}
			}

			// If not, let's look for another enemy
			if (!this.target) {
				this.targetPlayer = gameState.ai.HQ.attackManager.getEnemyPlayer(gameState, this);
				if (this.targetPlayer !== undefined)
					this.target = this.getNearestTarget(gameState, this.position, accessIndex);
				if (!this.target) {
/// DEBUG
					gameState.ai.logger.push("WARNING", "AttackManager", "No new target found. Remaining units " + this.unitCollection.length + ". Terminating UpdateTarget method.");
/// DEBUG
					return false;
				}
			}

/// DEBUG
			gameState.ai.logger.push("DEBUG", "AttackManager", "We will help one of our other attacks.");
/// DEBUG
		}
		this.targetPos = this.target.position();
	}
	return true;
};

/* reset any units */
ARCH.AttackPlan.prototype.Abort = function (gameState) {
	this.unitCollection.unregister();
	if (this.unitCollection.hasEntities()) {
		// If the attack was started, look for a good rallyPoint to withdraw
		let rallyPoint;
		if (this.isStarted()) {
			let access = this.getAttackAccess(gameState);
			let dist = Math.min();
			if (this.rallyPoint && gameState.ai.accessibility.getAccessValue(this.rallyPoint) === access) {
				rallyPoint = this.rallyPoint;
				dist = API3.SquareVectorDistance(this.position, rallyPoint);
			}
			// Then check if we have a nearer base (in case this attack has captured one)
			for (let base of gameState.ai.HQ.baseManagers) {
				if (!base.anchor || !base.anchor.position())
					continue;
				if (this.type !== "Naval" && ARCH.getLandAccess(gameState, base.anchor) !== access)
					continue;
				let newdist = API3.SquareVectorDistance(this.position, base.anchor.position());
				if (newdist > dist)
					continue;
				dist = newdist;
				rallyPoint = base.anchor.position();
			}
		}

		for (let ent of this.unitCollection.values()) {
			ent.stopMoving();
			if (rallyPoint)
				ent.moveToRange(rallyPoint[0], rallyPoint[1], 0, 15);
			this.removeUnit(ent);
		}
	}
};

ARCH.AttackPlan.prototype.removeUnit = function (ent, update) {
	if (ent.getMetadata(PlayerID, "soldier")) {
		ent.setMetadata(PlayerID, "role", "worker");
	} else if (ent.getMetadata(PlayerID, "type") === "Army") {
		ent.setMetadata(PlayerID, "role", "attacker");
	} else ent.setMetadata(PlayerID, "role", "defender");

	ent.setMetadata(PlayerID, "subrole", undefined);
	ent.setMetadata(PlayerID, "plan", -1);
	if (update)
		this.unitCollection.updateEnt(ent);
};

ARCH.AttackPlan.prototype.checkEvents = function (gameState, events) {
	for (let evt of events.EntityRenamed) {
		if (!this.target || this.target.id() !== evt.entity)
			continue;
		/*if (this.type === "Raid" && !this.isStarted())
			this.target = undefined;
		else*/
		this.target = gameState.getEntityById(evt.newentity);
		if (this.target)
			this.targetPos = this.target.position();
	}

	for (let evt of events.OwnershipChanged)	// capture event
		if (this.target && this.target.id() === evt.entity && gameState.isPlayerAlly(evt.to))
			this.target = undefined;

	for (let evt of events.PlayerDefeated) {
		if (this.targetPlayer !== evt.playerId)
			continue;
		this.targetPlayer = gameState.ai.HQ.attackManager.getEnemyPlayer(gameState, this);
		this.target = undefined;
	}

	if (!this.overseas || this.state !== "unexecuted")
		return;
	// let's check if an enemy has built a structure at our access
	for (let evt of events.Create) {
		let ent = gameState.getEntityById(evt.entity);
		if (!ent || !ent.position() || !ent.hasClass("Structure"))
			continue;
		if (!gameState.isPlayerEnemy(ent.owner()))
			continue;
		let access = ARCH.getLandAccess(gameState, ent);
		for (let base of gameState.ai.HQ.baseManagers) {
			if (!base.anchor || !base.anchor.position())
				continue;
			if (base.accessIndex !== access)
				continue;
			this.overseas = 0;
			this.rallyPoint = base.anchor.position();
		}
	}
};

ARCH.AttackPlan.prototype.hasSiegeUnits = function () {
	for (let ent of this.unitCollection.values())
		if (ARCH.isSiegeUnit(ent))
			return true;
	return false;
};

ARCH.AttackPlan.prototype.waitingForTransport = function () {
	for (let ent of this.unitCollection.values())
		if (ent.getMetadata(PlayerID, "transport") !== undefined)
			return true;
	return false;
};

ARCH.AttackPlan.prototype.hasForceOrder = function (data, value) {
	for (let ent of this.unitCollection.values()) {
		if (data && +ent.getMetadata(PlayerID, data) !== value)
			continue;
		let orders = ent.unitAIOrderData();
		for (let order of orders)
			if (order.force)
				return true;
	}
	return false;
};

/** Raid target finder aims at destructing foundations from which our defenceManager has attacked the builders */
ARCH.AttackPlan.prototype.raidTargetFinder = function (gameState) {
	let targets = new API3.EntityCollection(gameState.sharedScript);
	for (let targetId of gameState.ai.HQ.defenceManager.targetList) {
		let target = gameState.getEntityById(targetId);
		if (target && target.position())
			targets.addEnt(target);
	}
	return targets;
};

/**
 * The center position of this attack may be in an inaccessible area. So we use the access
 * of the unit nearest to this center position.
 */
ARCH.AttackPlan.prototype.getAttackAccess = function (gameState) {
	for (let ent of this.unitCollection.filterNearest(this.position, 1).values())
		return ARCH.getLandAccess(gameState, ent);

	return 0;
};

/// DEBUG
ARCH.AttackPlan.prototype.debugAttack = function () {
	this.logger.push("DEBUG", "AttackManager", this.type + " attack " + this.name + " plan size: " + this.unitCollection.length);
};
/// DEBUG
