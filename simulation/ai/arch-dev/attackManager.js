let ARCH = function (m) {

	/** Attack Manager */

	m.AttackManager = function (Config) {
		this.Config = Config;

		this.totalNumber = 0;
		this.attackNumber = 0;
		this.upcomingAttacks = {"Rush": [], "Raid": [], "Check": [], "Mate": [], "Naval": []};
		this.startedAttacks = {"Rush": [], "Raid": [], "Check": [], "Mate": [], "Naval": []};
		this.unexecutedAttacks = {"Rush": 0, "Raid": 0, "Check": 0, "Mate": 0, "Naval": 0};

		// shipsRequired is the minimal number of ships which should be available for transport
		this.shipsRequired = {"Rush": 1, "Raid": 3, "Check": 5, "Mate": 10, "Naval": 0};
		this.turnLimit = {"Rush": 100, "Raid": 200, "Check": 400, "Mate": 1600, "Naval": 300};
		this.completingTime = {"Rush": 30, "Raid": 35, "Check": 40, "Mate": 45, "Naval": 0};
		this.exptectedDestroyers = {"Rush": 1, "Raid": 2, "Check": 4, "Mate": 8, "Naval": 0};
		this.sizeRequired = {"Rush": 10, "Raid": 20, "Check": 40, "Mate": 80, "Naval": 5};
		this.checkAttack = false;

		this.bombingAttacks = new Map();// Temporary attacks for siege units while waiting their current attack to start
/// DEBUG
		this.debugTime = 0;
/// DEBUG
		this.currentEnemyPlayer = undefined; // enemy player we are currently targeting
		this.defeated = {};

		this.NavalAttackTurn = 0;
		this.lastAttack = false;
	};

	/* More initialisation for stuff that needs the gameState */
	m.AttackManager.prototype.init = function (gameState) {
	};

	/*
	 * Check for any structure in range from within our territory, and bomb it
	 */
	m.AttackManager.prototype.assignBombers = function (gameState) {
		// First some cleaning of current bombing attacks
		for (let [targetId, unitIds] of this.bombingAttacks) {
			let target = gameState.getEntityById(targetId);
			if (!target || !gameState.isPlayerEnemy(target.owner()))
				this.bombingAttacks.delete(targetId);
			else {
				for (let entId of unitIds.values()) {
					let ent = gameState.getEntityById(entId);
					if (ent && ent.owner() === PlayerID) {
						let plan = ent.getMetadata(PlayerID, "plan");
						let orders = ent.unitAIOrderData();
						let lastOrder = orders && orders.length ? orders[orders.length - 1] : null;
						if (lastOrder && lastOrder.target && lastOrder.target === targetId && plan !== -2 && plan !== -3)
							continue;
					}
					unitIds.delete(entId);
				}
				if (!unitIds.size)
					this.bombingAttacks.delete(targetId);
			}
		}

		let bombers = gameState.updatingCollection("bombers", API3.Filters.byClassesOr(["BoltShooter", "Catapult"]), gameState.getOwnUnits());
		for (let ent of bombers.values()) {
			if (!ent.position() || !ent.isIdle() || !ent.attackRange("Ranged"))
				continue;
			if (ent.getMetadata(PlayerID, "plan") === -2 || ent.getMetadata(PlayerID, "plan") === -3)
				continue;
			if (ent.getMetadata(PlayerID, "plan") !== undefined && ent.getMetadata(PlayerID, "plan") !== -1) {
				let subrole = ent.getMetadata(PlayerID, "subrole");
				if (subrole && (subrole === "completing" || subrole === "walking" || subrole === "attacking"))
					continue;
			}
			let alreadyBombing = false;
			for (let unitIds of this.bombingAttacks.values()) {
				if (!unitIds.has(ent.id()))
					continue;
				alreadyBombing = true;
				break;
			}
			if (alreadyBombing)
				break;

			let range = ent.attackRange("Ranged").max;
			let entPos = ent.position();
			let access = m.getLandAccess(gameState, ent);
			for (let struct of gameState.getEnemyStructures().values()) {
				let structPos = struct.position();
				let x;
				let z;
				if (struct.hasClass("Field")) {
					if (!struct.resourceSupplyNumGatherers() ||
						!gameState.isPlayerEnemy(gameState.ai.HQ.territoryMap.getOwner(structPos)))
						continue;
				}
				let dist = API3.VectorDistance(entPos, structPos);
				if (dist > range) {
					let safety = struct.footprintRadius() + 30;
					x = structPos[0] + (entPos[0] - structPos[0]) * safety / dist;
					z = structPos[1] + (entPos[1] - structPos[1]) * safety / dist;
					let owner = gameState.ai.HQ.territoryMap.getOwner([x, z]);
					if (owner !== 0 && gameState.isPlayerEnemy(owner))
						continue;
					x = structPos[0] + (entPos[0] - structPos[0]) * range / dist;
					z = structPos[1] + (entPos[1] - structPos[1]) * range / dist;
					if (gameState.ai.HQ.territoryMap.getOwner([x, z]) !== PlayerID ||
						gameState.ai.accessibility.getAccessValue([x, z]) !== access)
						continue;
				}
				let attackingUnits;
				for (let [targetId, unitIds] of this.bombingAttacks) {
					if (targetId !== struct.id())
						continue;
					attackingUnits = unitIds;
					break;
				}
				if (attackingUnits && attackingUnits.size > 4)
					continue;	// already enough units against that target
				if (!attackingUnits) {
					attackingUnits = new Set();
					this.bombingAttacks.set(struct.id(), attackingUnits);
				}
				attackingUnits.add(ent.id());
				if (dist > range)
					ent.move(x, z);
				ent.attack(struct.id(), false, dist > range);
				break;
			}
		}
	};

	/**
	 * Some functions are run every turn
	 * Others once in a while
	 */
	m.AttackManager.prototype.update = function (gameState, queues, events) {
		this.currentPhase = gameState.currentPhase();

		let popRatio = gameState.getPopulation() / gameState.getPopulationMax();

		this.popScale = gameState.getPopulationMax() / 300;

		// Disable Attack Manager on Ceasefire and/or until we reach Phase 3
		if (gameState.isCeasefireActive() || (popRatio < 0.95 && this.currentPhase < 3)) {
/// DEBUG
			gameState.ai.logger.push("INFO", "AttackManager", "Attack Manager is disabled. Ceasefire active: " + gameState.isCeasefireActive());
/// DEBUG
			return;
		}

/// DEBUG
		if (gameState.ai.elapsedTime > this.debugTime + 60) {
			this.debugTime = gameState.ai.elapsedTime;

			let attackList = [this.upcomingAttacks, this.startedAttacks];
			let attackText = ["Upcoming", "Incoming"];

			for (let i in attackList) {
				gameState.ai.logger.push("WARNING", "AttackManager", attackText[i] + " attacks =================");
				for (let attackType in attackList[i]) {
					for (let attack of attackList[i][attackType]) {
						gameState.ai.logger.push("WARNING", "AttackManager", "Attack plan " + attack.name + " type " + attackType + " state " + attack.state + " units " + attack.unitCollection.length + "/" + attack.size);
					}
				}
			}
		}
/// DEBUG
		this.checkEvents(gameState, events);

		for (let attackType in this.upcomingAttacks) {
			for (let i = 0; i < this.upcomingAttacks[attackType].length; ++i) {
				let attack = this.upcomingAttacks[attackType][i];
				attack.checkEvents(gameState, events);
/// DEBUG
				if (attack.isStarted()) {
					gameState.ai.logger.push("BUG", "AttackManager", "Attack preparation has already started ???");
				}
/// DEBUG
				let updateStep = attack.updatePreparation(gameState);
				// now we're gonna check if the preparation time is over
				if (updateStep === 1 || attack.isPaused()) {
					if (attack.state === "unexecuted")
						++this.unexecutedAttacks[attackType];
				} else if (updateStep === 0) {
/// DEBUG
					gameState.ai.logger.push("WARNING", "AttackManager", attack.getType() + " plan " + attack.getName() + " aborted.");
/// DEBUG
					attack.Abort(gameState);
					this.attackNumber = Math.max(0, this.attackNumber - 1);
					this.upcomingAttacks[attackType].splice(i--, 1);
				} else if (updateStep === 2) {
					if (attack.StartAttack(gameState)) {
/// DEBUG
						gameState.ai.logger.push("WARNING", "AttackManager", "Starting " + attack.getType() + " plan " + attack.getName());
/// DEBUG
						if (this.Config.chat)
							m.chatLaunchAttack(gameState, attack.targetPlayer, attack.getType());
						this.startedAttacks[attackType].push(attack);

						this.checkAttack = attackType === "Check";
					} else
						attack.Abort(gameState);
					this.attackNumber = Math.max(0, this.attackNumber - 1);
					this.upcomingAttacks[attackType].splice(i--, 1);
				}
			}
		}

		for (let attackType in this.startedAttacks) {
			for (let i = 0; i < this.startedAttacks[attackType].length; ++i) {
				let attack = this.startedAttacks[attackType][i];
				attack.checkEvents(gameState, events);
				// okay so then we'll update the attack.
				if (attack.isPaused())
					continue;
				let remaining = attack.update(gameState, events);
				if (!remaining) {
/// DEBUG
					gameState.ai.logger.push("WARNING", "AttackManager", attack.getType() + " plan " + attack.getName() + " is finished with remaining " + remaining);
/// DEBUG
					attack.Abort(gameState);
					this.attackNumber = Math.max(0, this.attackNumber - 1);
					this.startedAttacks[attackType].splice(i--, 1);
				}
			}
		}

		// creating plans after updating because an aborted plan might be reused in that case.

		let attackCount = 0;
		let plannedAttackCount = 0;
		let unexecutedAttackCount = 0;
		for (let hash in this.startedAttacks) {
			attackCount += this.startedAttacks[hash].length;
			plannedAttackCount += this.upcomingAttacks[hash].length;
			unexecutedAttackCount += this.unexecutedAttacks[hash];
		}

		let unitCollection = gameState.getOwnUnits().filter(API3.Filters.byMetadata(PlayerID, "soldier", true));
		let shipCollection = gameState.getOwnUnits().filter(API3.Filters.byMetadata(PlayerID, "type", "Warship"));

		let destroyerCount = 0;
		for (let ent of gameState.getOwnEntities().values()) {
			if (this.isDestroyer(ent)) {
				destroyerCount++;
			}
		}

		let attackSum = attackCount + unexecutedAttackCount + plannedAttackCount;

		let attack = false;
		for (let type in this.exptectedDestroyers) {
			if (type === "Naval") {
				if (gameState.ai.HQ.navalMap && shipCollection.length >= this.sizeRequired[type] && this.NavalAttackTurn + 360 < gameState.ai.playedTurn) {
					attack = type;
					this.NavalAttackTurn = gameState.ai.playedTurn;
				}
			} else if (destroyerCount / this.exptectedDestroyers[type] + unitCollection.length / (this.popScale * this.sizeRequired[type]) >= 2) {
				attack = type;
			}
		}

		// Random Naval Attack as a secondary attack
		if (attackSum === 1 && this.lastAttack !== "Naval" && gameState.ai.HQ.navalMap && shipCollection.length > 0 && (this.NavalAttackTurn === 0 || this.NavalAttackTurn + randIntExclusive(30, 600) < gameState.ai.playedTurn)) {
			attack = "Naval";
			this.NavalAttackTurn = gameState.ai.playedTurn;
		}

		if (!attack && popRatio > 0.975) {
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", "Not enough soldiers and/or destroyers. Default attack (Rush) is initiated due to high population.");
/// DEBUG
			attack = "Rush";
		}
		// First say check before mate :)
		else if (attack === "Mate" && !this.checkAttack) {
			attack = "Check";
		}

/// DEBUG
		if (attack) {
			gameState.ai.logger.push("INFO", "AttackManager", "Selected attack type: " + attack);
		}
/// DEBUG

		let hasEnemies = false;
		for (let i = 1; i < gameState.sharedScript.playersData.length; ++i) {
			if (!gameState.isPlayerEnemy(i) || gameState.ai.HQ.attackManager.defeated[i])
				continue;
			hasEnemies = true;
			break;
		}

		let allowAttack = false;

		if (hasEnemies
			&& attack
			&& ((attack === "Naval" && attackSum < 2) ||
				(attackSum === 0 && popRatio > 0.85))
		) {
			allowAttack = true;
			this.lastAttack = attack;
		} else {
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", "Attack Prevention. attack: " + attack + " attackCount: " + attackCount + " unexecutedAttackCount: " + unexecutedAttackCount + " nextAttacks: " + plannedAttackCount);
/// DEBUG
			return false;
		}
		if (allowAttack) {
			let attackPlan = new m.AttackPlan(gameState, this.Config, this.totalNumber, attack);
			if (attackPlan.failed) {
				this.attackPlansEncounteredWater = true; // hack? ???
/// DEBUG
				gameState.ai.logger.push("WARNING", "AttackManager", "Attack plan failed!");
/// DEBUG
			} else {
/// DEBUG
				gameState.ai.logger.push("WARNING", "AttackManager", "Creating the plan " + attack + " " + this.attackNumber + " Total Plan Count: " + this.totalNumber);
/// DEBUG
				this.totalNumber++;
				if (attack !== "Naval") {
					attackPlan.init(gameState, unitCollection);
				} else {
					attackPlan.init(gameState, shipCollection);
				}

				this.upcomingAttacks[attack].push(attackPlan);
				this.attackNumber++;
			}
		}
		// Try to start a raid attack
		else if (attackSum === 0 && gameState.ai.HQ.defenceManager.targetList.length) {
			let target;
			for (let targetId of gameState.ai.HQ.defenceManager.targetList) {
				target = gameState.getEntityById(targetId);
				if (!target)
					continue;
				if (gameState.isPlayerEnemy(target.owner()))
					break;
				target = undefined;
			}
			if (target) // prepare a raid against this target
			{
/// DEBUG
				gameState.ai.logger.push("WARNING", "AttackManager", "Preparing a raid attack!");
/// DEBUG
				this.raidTargetEntity(gameState, target);
			}
		}

		// Check if we have some unused ranged siege unit which could do something useful while waiting
		if (m.modCheck(gameState.ai.playedTurn, this.Config.Defence.bombingAttackPeriod)) {
			this.assignBombers(gameState);
		}
	};

	m.AttackManager.prototype.getAttackInPreparation = function (type) {
		return this.upcomingAttacks[type].length ? this.upcomingAttacks[type][0] : undefined;
	};

	/** f.e. if we have changed diplomacy with another player. */
	m.AttackManager.prototype.cancelAttacksAgainstPlayer = function (gameState, player) {
		for (let attackType in this.upcomingAttacks)
			for (let attack of this.upcomingAttacks[attackType])
				if (attack.targetPlayer === player)
					attack.targetPlayer = undefined;

		for (let attackType in this.startedAttacks)
			for (let i = 0; i < this.startedAttacks[attackType].length; ++i) {
				let attack = this.startedAttacks[attackType][i];
				if (attack.targetPlayer === player) {
					attack.Abort(gameState);
					this.attackNumber = Math.max(0, this.attackNumber - 1);
					this.startedAttacks[attackType].splice(i--, 1);
				}
			}
	};

	m.AttackManager.prototype.raidTargetEntity = function (gameState, ent) {
		let data = {"target": ent};
		let attackPlan = new m.AttackPlan(gameState, this.Config, this.totalNumber, "Raid", data);
		if (attackPlan.failed || this.upcomingAttacks["Raid"].length > 0) {
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", "Raid attack initiation failed!");
/// DEBUG
			return null;
		}
/// DEBUG
		gameState.ai.logger.push("WARNING", "AttackManager", "Raiding plan " + this.totalNumber);
/// DEBUG
		this.totalNumber++;
		attackPlan.init(gameState);
		this.upcomingAttacks.Raid.push(attackPlan);
		return attackPlan;
	};

	/**
	 * Switch defence armies into an attack one against the given target
	 * data.range: transform all defence armies inside range of the target into a new attack
	 * data.armyID: transform only the defence army ID into a new attack
	 * data.uniqueTarget: the attack will stop when the target is destroyed or captured
	 */
	m.AttackManager.prototype.switchDefenceToAttack = function (gameState, target, data) {
		if (!target || !target.position())
			return false;
		if (!data.range && !data.armyID) {
/// DEBUG
			gameState.ai.logger.push("BUG", "AttackManager", "Inconsistent data for Switch Defence to Attack: " + uneval(data));
/// DEBUG
			return false;
		}

		let attackCount = 0;
		let plannedAttackCount = 0;
		let unexecutedAttackCount = 0;
		for (let hash in this.startedAttacks) {
			attackCount += this.startedAttacks[hash].length;
			plannedAttackCount += this.upcomingAttacks[hash].length;
			unexecutedAttackCount += this.unexecutedAttacks[hash];
		}

		let attackSum = attackCount + unexecutedAttackCount + plannedAttackCount;

		if (attackSum > 1) {
/// DEBUG
			gameState.ai.logger.push("BUG", "AttackManager", "Allowed attack count has been reached, new Rush attack was cancelled. (switchDefenceToAttack)");
/// DEBUG
			return false;
		}

		let attackData = data.uniqueTarget ? {"uniqueTargetId": target.id()} : undefined;
		let pos = target.position();
		let attackType = "Rush";
		let attackPlan = new m.AttackPlan(gameState, this.Config, this.totalNumber, attackType, attackData);
		if (attackPlan.failed) {
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", "Switching defence armies to attack failed!");
/// DEBUG
			return false;
		}
		this.totalNumber++;
		attackPlan.init(gameState);
		this.startedAttacks[attackType].push(attackPlan);

		let targetAccess = m.getLandAccess(gameState, target);
		for (let army of gameState.ai.HQ.defenceManager.armies) {
			if (data.range) {
				army.recalculatePosition(gameState);
				if (API3.SquareVectorDistance(pos, army.foePosition) > data.range * data.range)
					continue;
			} else if (army.ID !== +data.armyID)
				continue;

			while (army.foeEntities.length > 0)
				army.removeFoe(gameState, army.foeEntities[0]);
			while (army.ownEntities.length > 0) {
				let unitId = army.ownEntities[0];
				army.removeOwn(gameState, unitId);
				let unit = gameState.getEntityById(unitId);
				if (!unit) {
					continue;
				}
				let accessOk = unit.getMetadata(PlayerID, "transport") !== undefined ||
					unit.position() && m.getLandAccess(gameState, unit) === targetAccess;
				if (unit && accessOk && attackPlan.isAvailableUnit(gameState, unit)) {
					unit.setMetadata(PlayerID, "plan", attackPlan.name);
					unit.setMetadata(PlayerID, "role", "attack");
					attackPlan.unitCollection.updateEnt(unit);
				}
			}
		}
		if (!attackPlan.unitCollection.hasEntities()) {
			attackPlan.Abort(gameState);
			this.attackNumber = Math.max(0, this.attackNumber - 1);
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", "Attack failed, all units were killed!");
/// DEBUG
			return false;
		}
		for (let unit of attackPlan.unitCollection.values())
			unit.setMetadata(PlayerID, "role", "attack");
		attackPlan.targetPlayer = target.owner();
		attackPlan.targetPos = pos;
		attackPlan.target = target;
		attackPlan.state = "arrived";
/// DEBUG
		gameState.ai.logger.push("WARNING", "AttackManager", "Switching defence armies into an attack!");
/// DEBUG
		return true;
	};

	///
	m.AttackManager.prototype.Serialize = function () {
		let properties = {
			"totalNumber": this.totalNumber,
			"attackNumber": this.attackNumber,
			"debugTime": this.debugTime,
			"currentEnemyPlayer": this.currentEnemyPlayer,
			"defeated": this.defeated
		};

		let upcomingAttacks = {};
		for (let key in this.upcomingAttacks) {
			upcomingAttacks[key] = [];
			for (let attack of this.upcomingAttacks[key])
				upcomingAttacks[key].push(attack.Serialize());
		}

		let startedAttacks = {};
		for (let key in this.startedAttacks) {
			startedAttacks[key] = [];
			for (let attack of this.startedAttacks[key])
				startedAttacks[key].push(attack.Serialize());
		}

		return {"properties": properties, "upcomingAttacks": upcomingAttacks, "startedAttacks": startedAttacks};
	};

	m.AttackManager.prototype.Deserialize = function (gameState, data) {
		for (let key in data.properties)
			this[key] = data.properties[key];

		this.upcomingAttacks = {};
		for (let key in data.upcomingAttacks) {
			this.upcomingAttacks[key] = [];
			for (let dataAttack of data.upcomingAttacks[key]) {
				let attack = new m.AttackPlan(gameState, this.Config, dataAttack.properties.name);
				attack.Deserialize(gameState, dataAttack);
				attack.init(gameState);
				this.upcomingAttacks[key].push(attack);
			}
		}

		this.startedAttacks = {};
		for (let key in data.startedAttacks) {
			this.startedAttacks[key] = [];
			for (let dataAttack of data.startedAttacks[key]) {
				let attack = new m.AttackPlan(gameState, this.Config, dataAttack.properties.name);
				attack.Deserialize(gameState, dataAttack);
				attack.init(gameState);
				this.startedAttacks[key].push(attack);
			}
		}
	};
	///
	return m;
}(ARCH);
