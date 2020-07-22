/** Attack Manager Utilities */

ARCH.AttackManager.prototype.checkEvents = function (gameState, events) {
	for (let evt of events.PlayerDefeated)
		this.defeated[evt.playerId] = true;

	let answer = "decline";
	let other;
	let targetPlayer;
	for (let evt of events.AttackRequest) {
		if (evt.source === PlayerID || !gameState.isPlayerAlly(evt.source) || !gameState.isPlayerEnemy(evt.player))
			continue;
		targetPlayer = evt.player;
		let available = 0;
		for (let attackType in this.upcomingAttacks) {
			for (let attack of this.upcomingAttacks[attackType]) {
				if (attack.state === "completing") {
					if (attack.targetPlayer === targetPlayer)
						available += attack.unitCollection.length;
					else if (attack.targetPlayer !== undefined && attack.targetPlayer !== targetPlayer)
						other = attack.targetPlayer;
					continue;
				}

				attack.targetPlayer = targetPlayer;

				if (attackType === "Naval" || attack.unitCollection.length > 2)
					available += attack.unitCollection.length;
			}
		}

		if (available)	// launch the attack immediately
		{
			for (let attackType in this.upcomingAttacks) {
				for (let attack of this.upcomingAttacks[attackType]) {
					if (attack.state === "completing" ||
						attack.targetPlayer !== targetPlayer ||
						(attackType !== "Naval" || attack.unitCollection.length < 3))
						continue;
					attack.forceStart();
					attack.requested = true;
				}
			}
			answer = "join";
		} else if (other !== undefined)
			answer = "other";
		break;  // take only the first attack request into account
	}
	if (targetPlayer !== undefined)
		ARCH.chatAnswerRequestAttack(gameState, targetPlayer, answer, other);

	for (let evt of events.EntityRenamed)	// take care of packing units in bombing attacks
	{
		for (let [targetId, unitIds] of this.bombingAttacks) {
			if (targetId === evt.entity) {
				this.bombingAttacks.set(evt.newentity, unitIds);
				this.bombingAttacks.delete(evt.entity);
			} else if (unitIds.has(evt.entity)) {
				unitIds.add(evt.newentity);
				unitIds.delete(evt.entity);
			}
		}
	}
};

ARCH.AttackManager.prototype.getPlan = function (planName) {
	for (let attackType in this.upcomingAttacks) {
		for (let attack of this.upcomingAttacks[attackType])
			if (attack.getName() === planName)
				return attack;
	}
	for (let attackType in this.startedAttacks) {
		for (let attack of this.startedAttacks[attackType])
			if (attack.getName() === planName)
				return attack;
	}
	return undefined;
};

ARCH.AttackManager.prototype.pausePlan = function (planName) {
	let attack = this.getPlan(planName);
	if (attack) {
		attack.setPaused(true);
/// DEBUG
		gameState.ai.logger.push("INFO", "AttackManager", "Plan " + planName + " was paused!");
/// DEBUG
	}

};

ARCH.AttackManager.prototype.unpausePlan = function (planName) {
	let attack = this.getPlan(planName);
	if (attack) {
		attack.setPaused(false);
/// DEBUG
		gameState.ai.logger.push("INFO", "AttackManager", "Plan " + planName + " was unpaused!");
/// DEBUG
	}
};

ARCH.AttackManager.prototype.pauseAllPlans = function () {
	for (let attackType in this.upcomingAttacks)
		for (let attack of this.upcomingAttacks[attackType])
			attack.setPaused(true);

	for (let attackType in this.startedAttacks)
		for (let attack of this.startedAttacks[attackType])
			attack.setPaused(true);

/// DEBUG
	gameState.ai.logger.push("INFO", "AttackManager", "All plans were paused!");
/// DEBUG
};

ARCH.AttackManager.prototype.unpauseAllPlans = function () {
	for (let attackType in this.upcomingAttacks)
		for (let attack of this.upcomingAttacks[attackType])
			attack.setPaused(false);

	for (let attackType in this.startedAttacks)
		for (let attack of this.startedAttacks[attackType])
			attack.setPaused(false);

/// DEBUG
	gameState.ai.logger.push("INFO", "AttackManager", "All plans were unpaused!");
/// DEBUG
};
/**
 * Determine which player should be attacked: when called when starting the attack,
 * attack.targetPlayer is undefined and in that case, we keep track of the chosen target
 * for future attacks.
 */
ARCH.AttackManager.prototype.getEnemyPlayer = function (gameState, attack) {
	let enemyPlayer;

	// First check if there is a preferred enemy based on our victory conditions.
	// If both wonder and relic, choose randomly between them TODO should combine decisions

	if (gameState.getVictoryConditions().has("wonder"))
		enemyPlayer = this.getWonderEnemyPlayer(gameState, attack);

	if (gameState.getVictoryConditions().has("capture_the_relic"))
		if (!enemyPlayer || randBool())
			enemyPlayer = this.getRelicEnemyPlayer(gameState, attack) || enemyPlayer;

	if (enemyPlayer)
		return enemyPlayer;

	let veto = {};
	for (let i in this.defeated)
		veto[i] = true;

	// ARCH: Always attack to the strongest player

	// then let's target our strongest enemy (basically counting enemies units)
	// with priority to enemies with civ center
	let max = 0;
	for (let i = 1; i < gameState.sharedScript.playersData.length; ++i) {
		if (veto[i])
			continue;
		if (!gameState.isPlayerEnemy(i))
			continue;

		let enemyDefence = 0;
		for (let ent of gameState.getEnemyStructures(i).values()) {
			if (ent.hasClass("Tower")) {
				enemyDefence += 25;
			} else if (ent.hasClass("Barracks")) {
				enemyDefence += 15;
			} else if (ent.hasClass("Blacksmith")) {
				enemyDefence += 5;
			} else if (ent.hasClass("Market")) {
				enemyDefence += 7;
			} else if (ent.hasClass("Fortress")) {
				enemyDefence += 100;
			}
		}
		let enemyPower = enemyDefence;
		for (let ent of gameState.getEntities(i).values()) {
			if (ent.hasClass("CivCentre") || ent.hasClass("Wonder")) {
				enemyPower += 500;
			}
			// Elephant workers cannot attack ( +2 Bonus for each elephant worker )
			else if (ent.hasClass("Support") && ent.hasClass("Elephant")) {
				enemyPower -= 2;
			}
			// Workers are vulnerable ( +1 Bonus for each worker )
			else if (ent.hasClass("Worker")) {
				enemyPower--;
			} else if (ent.hasClass("Infantry")) {
				enemyPower += 2;
			} else if (ent.hasClass("Ranged")) {
				enemyPower += 3;
			} else if (ent.hasClass("Cavalry")) {
				enemyPower += 5;
			} else if (ent.hasClass("Elephant")) {
				enemyPower += 7;
			} else {
				enemyPower++;
			}
		}
		if (!enemyPower || enemyPower < max)
			continue;
		max = enemyPower;
		enemyPlayer = i;
	}
	if (attack.targetPlayer === undefined)
		this.currentEnemyPlayer = enemyPlayer;
	return enemyPlayer;
};

/**
 * Target the player with the most advanced wonder.
 * TODO currently the first built wonder is kept, should chek on the minimum wonderDuration left instead.
 */
ARCH.AttackManager.prototype.getWonderEnemyPlayer = function (gameState, attack) {
	let enemyPlayer;
	let enemyWonder;
	let moreAdvanced;
	for (let wonder of gameState.getEnemyStructures().filter(API3.Filters.byClass("Wonder")).values()) {
		if (wonder.owner() === 0)
			continue;
		let progress = wonder.foundationProgress();
		if (progress === undefined) {
			enemyWonder = wonder;
			break;
		}
		if (enemyWonder && moreAdvanced > progress)
			continue;
		enemyWonder = wonder;
		moreAdvanced = progress;
	}
	if (enemyWonder) {
		enemyPlayer = enemyWonder.owner();
		if (attack.targetPlayer === undefined)
			this.currentEnemyPlayer = enemyPlayer;
	}
	return enemyPlayer;
};

/**
 * Target the player with the most relics (including gaia).
 */
ARCH.AttackManager.prototype.getRelicEnemyPlayer = function (gameState, attack) {
	let enemyPlayer;
	let allRelics = gameState.updatingGlobalCollection("allRelics", API3.Filters.byClass("Relic"));
	let maxRelicsOwned = 0;
	for (let i = 0; i < gameState.sharedScript.playersData.length; ++i) {
		if (!gameState.isPlayerEnemy(i) || this.defeated[i] ||
			i === 0 && !gameState.ai.HQ.victoryManager.tryCaptureGaiaRelic)
			continue;

		let relicsCount = allRelics.filter(relic => relic.owner() === i).length;
		if (relicsCount <= maxRelicsOwned)
			continue;
		maxRelicsOwned = relicsCount;
		enemyPlayer = i;
	}
	if (enemyPlayer !== undefined) {
		if (attack.targetPlayer === undefined)
			this.currentEnemyPlayer = enemyPlayer;
		if (enemyPlayer === 0)
			gameState.ai.HQ.victoryManager.resetCaptureGaiaRelic(gameState);
	}
	return enemyPlayer;
};

/**
 * Return the number of units from any of our attacking armies around this position
 */
ARCH.AttackManager.prototype.numAttackingUnitsAround = function (pos, dist) {
	let num = 0;
	for (let attackType in this.startedAttacks)
		for (let attack of this.startedAttacks[attackType]) {
			if (!attack.position)	// this attack may be inside a transport
				continue;
			if (API3.SquareVectorDistance(pos, attack.position) < dist * dist)
				num += attack.unitCollection.length;
		}
	return num;
};

ARCH.AttackManager.prototype.checkPhase = function (gameState, phase) {
	return this.currentPhase >= phase || gameState.isResearching(gameState.getPhaseName(phase));
};

// TODO: Add more destroyer type units
ARCH.AttackManager.prototype.isDestroyer = function (ent) {
	return ent.hasClass("Unit") && (ent.hasClass("Hero") ||
		(ent.hasClass("Champion") && (ent.hasClass("Elephant") || ent.hasClass("Cavalry") || ent.hasClass("Chariot"))) ||
		ent.hasClass("Siege"));
};
