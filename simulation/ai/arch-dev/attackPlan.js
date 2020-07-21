let ARCH = function (m) {

	/**
	 * This is an attack plan:
	 * It deals with everything in an attack, from picking a target to picking a path to it
	 * To making sure units are built, and pushing elements to the queue manager otherwise
	 * It also handles the actual attack, though much work is needed on that.
	 * @return {boolean}
	 */

	m.AttackPlan = function (gameState, Config, uniqueID, type, data) {
		this.Config = Config;
		this.name = uniqueID;
		this.type = type || "Check";
		this.state = "unexecuted";
		this.size = 0;
		this.forced = false;  // true when this attacked has been forced to help an ally

		this.logger = gameState.ai.logger;

		this.exptectedDestroyers = gameState.ai.HQ.attackManager.exptectedDestroyers[this.type];
		this.sizeRequired = gameState.ai.HQ.attackManager.sizeRequired[this.type];

		// shipsRequired is the minimal number of ships which should be available for transport
		this.shipsRequired = gameState.ai.HQ.attackManager.shipsRequired[this.type];
		this.turnLimit = gameState.ai.HQ.attackManager.turnLimit[this.type];
		this.completingTime = gameState.ai.HQ.attackManager.completingTime[this.type];

/// DEBUG
		gameState.ai.logger.push("INFO", "AttackManager", "Initiating " + this.type + " attack " + this.name + " plan!");
/// DEBUG

		if (data && data.target) {
			this.target = data.target;
			this.targetPos = this.target.position();
			this.targetPlayer = this.target.owner();
		} else {
			this.target = undefined;
			this.targetPos = undefined;
			this.targetPlayer = undefined;
		}

		this.uniqueTargetId = data && data.uniqueTargetId || undefined;

		// get a starting rallyPoint ... will be improved later
		let rallyPoint;
		let rallyAccess;
		let allAccesses = {};
		for (let base of gameState.ai.HQ.baseManagers) {
			if (!base.anchor || !base.anchor.position())
				continue;
			let access = m.getLandAccess(gameState, base.anchor);
			if (!rallyPoint) {
				rallyPoint = base.anchor.position();
				rallyAccess = access;
			}
			if (!allAccesses[access])
				allAccesses[access] = base.anchor.position();
		}
		if (!rallyPoint)	// no base ?  take the position of any of our entities
		{
			for (let ent of gameState.getOwnEntities().values()) {
				if (!ent.position())
					continue;
				let access = m.getLandAccess(gameState, ent);
				rallyPoint = ent.position();
				rallyAccess = access;
				allAccesses[access] = rallyPoint;
				break;
			}
			if (!rallyPoint) {
				this.failed = true;
/// DEBUG
				gameState.ai.logger.push("BUG", "AttackManager", "Rally point does not exist!");
/// DEBUG
				return false;
			}
		}
		this.rallyPoint = rallyPoint;
		this.overseas = 0;
		if (this.type !== "Naval" && gameState.ai.HQ.navalMap) {
			for (let structure of gameState.getEnemyStructures().values()) {
				if (this.target && structure.id() !== this.target.id())
					continue;
				if (!structure.position())
					continue;
				let access = m.getLandAccess(gameState, structure);
				if (access in allAccesses) {
					this.overseas = 0;
					this.rallyPoint = allAccesses[access];
					break;
				} else if (!this.overseas) {
					let sea = gameState.ai.HQ.getSeaBetweenIndices(gameState, rallyAccess, access);
					if (!sea) {
						if (this.target) {
/// DEBUG
							gameState.ai.logger.push("BUG", "AttackManager", this.type + " " + this.name + " has an inaccessible target " +
								this.target.templateName() + " indices " + rallyAccess + " " + access);
/// DEBUG
							this.failed = true;
							return false;
						}
						continue;
					}
					this.overseas = sea;
					gameState.ai.HQ.navalManager.setMinimalTransportShips(gameState, sea, 1);
				}
			}
		}
		this.paused = false;
		this.maxCompletingTime = 0;
		this.startTurn = gameState.ai.playedTurn;

		// some variables used during the attack
		this.lastCheckedPosition = [0, 0];
		this.lastCheckedTurn = 0;
		this.lastPosition = [0, 0];
		this.position = [0, 0];
		this.isBlocked = false;	     // true when this attack faces walls

		return true;
	};

	m.AttackPlan.prototype.init = function (gameState, unitCollection = undefined) {

		if (unitCollection) {
			this.unitCollection = unitCollection;
		} else if (this.type === "Naval") {
			this.unitCollection = gameState.getOwnUnits().filter(API3.Filters.byMetadata(PlayerID, "type", "Warship"));
		} else {
			this.unitCollection = gameState.getOwnUnits().filter(API3.Filters.byMetadata(PlayerID, "soldier", true));
		}

		this.unitCollection.registerUpdates();
	};

	/** Three returns possible: 1 is "keep going", 0 is "failed plan", 2 is "start". */
	m.AttackPlan.prototype.updatePreparation = function (gameState) {
		// the completing step is used to return resources and regroup the units
		// so we check that we have no more forced order before starting the attack
		if (this.state === "completing") {
			// if our target was destroyed, go back to "unexecuted" state
			if (this.targetPlayer === undefined || !this.target || !gameState.getEntityById(this.target.id())) {
				this.state = "unexecuted";
				this.target = undefined;
/// DEBUG
				gameState.ai.logger.push("DEBUG", "AttackManager", "Target was destroyed, going back to unexecuted state");
/// DEBUG
			} else {
				// check that all units have finished with their transport if needed
				if (this.type !== "Naval" && this.waitingForTransport()) {
/// DEBUG
					gameState.ai.logger.push("DEBUG", "AttackManager", "Waiting for transport");
/// DEBUG
					return 1;
				}
				// blocked units which cannot finish their order should not stop the attack
				if (gameState.ai.elapsedTime < this.maxCompletingTime && this.hasForceOrder()) {
/// DEBUG
					gameState.ai.logger.push("DEBUG", "AttackManager", "Has Forced Order, continue preparation");
/// DEBUG
					return 1;
				}

				this.size = this.unitCollection.length;
				return 2;
			}
		}
/// DEBUG
		this.debugAttack();
/// DEBUG

		if (this.type === "Naval") {
			this.assignShips(gameState);
		} else {
			// if we need a transport, wait for some transport ships
			if (this.overseas && !gameState.ai.HQ.navalManager.seaTransportShips[this.overseas].length)
				return 1;

			if (this.type !== "Raid" || !this.forced)    // Forced Raids have special purposes (as relic capture)
				this.assignUnits(gameState);
			if (this.type !== "Raid" && gameState.ai.HQ.attackManager.getAttackInPreparation("Raid") !== undefined)
				this.reassignCavUnit(gameState);    // reassign some cav (if any) to fasten raid preparations
		}

		if (this.type !== "Naval") {
			this.countDestroyers(gameState);
/// DEBUG
			gameState.ai.logger.push("INFO", "AttackManager", "Preparing " + this.type + " attack " + this.name + " plan with " + this.destroyerCount + " destroyers!");
/// DEBUG
		}

		// if we're here, it means we must start
		this.state = "completing";

		// Raids have their predefined target
		if (!this.target && !this.chooseTarget(gameState)) {
/// DEBUG
			gameState.ai.logger.push("BUG", "AttackManager", "Attack prevention: Invalid target!");
/// DEBUG
			return 0;
		}
		if (!this.overseas)
			this.getPathToTarget(gameState);

		if (this.type === "Raid") {
			this.maxCompletingTime = this.forced ? 0 : gameState.ai.elapsedTime + this.completingTime;
		} else {
			this.maxCompletingTime = gameState.ai.elapsedTime + this.completingTime;

			// warn our allies so that they can help if possible
			if (!this.requested)
				Engine.PostCommand(PlayerID, {
					"type": "attack-request",
					"source": PlayerID,
					"player": this.targetPlayer
				});
		}

		// Remove those units which were in a temporary bombing attack
		for (let unitIds of gameState.ai.HQ.attackManager.bombingAttacks.values()) {
			for (let entId of unitIds.values()) {
				let ent = gameState.getEntityById(entId);
				if (!ent || ent.getMetadata(PlayerID, "plan") !== this.name)
					continue;
				unitIds.delete(entId);
				ent.stopMoving();
			}
		}

		let rallyPoint = this.rallyPoint;
		for (let ent of this.unitCollection.values()) {

			if (this.type === "Naval") {
				ent.setMetadata(PlayerID, "role", "attack");
				ent.setMetadata(PlayerID, "subrole", "completing");
				ent.moveToRange(rallyPoint[0], rallyPoint[1], 0, 15);
			} else {
				let rallyIndex = gameState.ai.accessibility.getAccessValue(rallyPoint);

				// For the time being, if occupied in a transport, remove the unit from this plan   TODO improve that
				if (ent.getMetadata(PlayerID, "transport") !== undefined || ent.getMetadata(PlayerID, "transporter") !== undefined) {
					ent.setMetadata(PlayerID, "plan", -1);
					continue;
				}
				ent.setMetadata(PlayerID, "role", "attack");
				ent.setMetadata(PlayerID, "subrole", "completing");
				let queued = false;
				if (ent.resourceCarrying() && ent.resourceCarrying().length)
					queued = m.returnResources(gameState, ent);
				let index = m.getLandAccess(gameState, ent);
				if (index) {
					if (index === rallyIndex)
						ent.moveToRange(rallyPoint[0], rallyPoint[1], 0, 15, queued);
					else
						gameState.ai.HQ.navalManager.requireTransport(gameState, ent, index, rallyIndex, rallyPoint);
				}
			}
		}

		return 1;
	};

	m.AttackPlan.prototype.assignShips = function (gameState) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Starting to assign ships for " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
		let plan = this.name;
		let added = 0;

		// Assign all Warships
		for (let ent of gameState.getOwnUnits().filter(API3.Filters.byMetadata(PlayerID, "ship", true)).values()) {
			let type = ent.getMetadata(PlayerID, "type");

			if (!type) {
/// DEBUG
				gameState.ai.logger.push("ERROR", "AttackManager", "Ship without a type!");
				continue;
/// DEBUG
			}

			if (!this.isAvailableUnit(gameState, ent, 0)) { // TODO: First code to repair damaged ships, then increase the expected health value :)
/// DEBUG
				gameState.ai.logger.push("DEBUG", "AttackManager", "Ship unit was excluded from the collection: Ship is not available.");
/// DEBUG
				continue;
			}

			if (type !== "Warship") {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "AttackManager", "Ship unit was excluded from the collection: Warships can only be used at Naval attacks.");
/// DEBUG
				continue;
			}

			ent.setMetadata(PlayerID, "plan", plan);
			this.unitCollection.addEnt(ent);
			added++;
/// DEBUG
			gameState.ai.logger.push("DEBUG", "AttackManager", "New Attack Ship: " + ent.getMetadata(PlayerID, "type") + " was collected for " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
		}
/// DEBUG
		gameState.ai.logger.push("INFO", "AttackManager", "Ships were collected: " + added + " for " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG

		return added;
	};

	m.AttackPlan.prototype.assignUnits = function (gameState) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "AttackManager", "Starting to assign units for " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
		let plan = this.name;
		let added = 0;

		// If we cannot build units, assign all available except those affected to allied defence to the current attack
		if (!gameState.ai.HQ.canBuildUnits) {
			for (let ent of gameState.getOwnUnits().values()) {
				if (ent.getMetadata(PlayerID, "allied") || !this.isAvailableUnit(gameState, ent))
					continue;
				ent.setMetadata(PlayerID, "plan", plan);
				this.unitCollection.updateEnt(ent);
				added++;
/// DEBUG
				gameState.ai.logger.push("DEBUG", "AttackManager", "New Attack Unit: " + ent.getMetadata(PlayerID, "type") + " was collected for " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
			}
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", "Unit production is not available. Only " + added + " units were collected for " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
			return added;
		}

		// Assign all available units except Support units
		let collectedDestroyers = 0;
		let collectedVillagers = 0;
		let collectedInfantry = 0;
		let collectedUnits = 0;
		for (let ent of gameState.getOwnUnits().values()) {
			let type = ent.getMetadata(PlayerID, "type");

			if (!type) {
/// DEBUG
				if (!ent._ai._entityMetadata[PlayerID][ent.id()]) {
					gameState.ai.logger.push("DEBUG", "AttackManager", "Unit was excluded from the collection: Unit type is undefined.");
				} else {
					let data = ent._ai._entityMetadata[PlayerID][ent.id()];

					let text = "Unit was skipped for collection: Unit type is not suitable. { ";

					for (let oData in data) {
						text += uneval(oData) + ",";
					}

					text += " }";

					gameState.ai.logger.push("DEBUG", "AttackManager", text);
				}
/// DEBUG
				continue;
			}

			if (!this.isAvailableUnit(gameState, ent, 0.5)) {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "AttackManager", "Unit was excluded from the collection: Unit is not available.");
/// DEBUG
				continue;
			}

			if (ent.hasClass("Ship")) {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "AttackManager", "Ship unit was excluded from the collection: Ships can only be used at Naval attacks.");
/// DEBUG
				continue;
			}

			if (type === "Support") { // Support Elephant cannot fight
/// DEBUG
				gameState.ai.logger.push("DEBUG", "AttackManager", "Support unit was excluded from the collection: Support units cannot fight.");
/// DEBUG
				continue;
			}

			if (type === "Villager") {
				// Include villagers only if the count of the villagers is greater than the 1/3 of the max population.
				if (gameState.ai.HQ.trainingManager.count["Villager"] - collectedVillagers > gameState.getPopulationMax() / 3) {
					collectedVillagers++;
				} else {
/// DEBUG
					gameState.ai.logger.push("DEBUG", "AttackManager", "Villager unit was excluded from the collection: Number of Villagers are not too many to be spent.");
/// DEBUG
					continue;
				}
			}

			if (gameState.ai.HQ.attackManager.isDestroyer(ent)) {
				if (collectedDestroyers < (this.type === "Mate" ? gameState.getPopulationMax() : this.exptectedDestroyers)) {
/// DEBUG
					gameState.ai.logger.push("DEBUG", "AttackManager", "New Destroyer Unit: " + ent.getMetadata(PlayerID, "type") + " was collected for " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
					collectedDestroyers++;
				} else {
/// DEBUG
					gameState.ai.logger.push("DEBUG", "AttackManager", "Destroyer unit was excluded from the collection: " + this.type + " attack " + this.name + " plan has already " + this.exptectedDestroyers + " destroyers.");
/// DEBUG
					continue;
				}
			} else if (type === "Infantry") {
				// Include infantry only if we have enough defenders.
				if (gameState.ai.HQ.trainingManager.count["Infantry"] - collectedInfantry > this.Config.Defence.backupSize) {
					collectedInfantry++;
				} else {
/// DEBUG
					gameState.ai.logger.push("DEBUG", "AttackManager", "Infantry unit was excluded from the collection: This unit should be kept as a defender.");
/// DEBUG
					continue;
				}
			}
/// DEBUG
			else {
				gameState.ai.logger.push("DEBUG", "AttackManager", "New Attack Unit: " + ent.getMetadata(PlayerID, "type") + " was collected for " + this.type + " attack, plan: " + this.name + ".");
			}
/// DEBUG
			ent.setMetadata(PlayerID, "plan", plan);
			this.unitCollection.addEnt(ent);
			added++;
			collectedUnits++;

			if (collectedUnits >= (this.type === "Mate" ? gameState.getPopulationMax() : this.sizeRequired)) {
				break;
			}
		}
/// DEBUG
		gameState.ai.logger.push("INFO", "AttackManager", "Units were collected: " + collectedUnits + " for " + this.type + " attack, plan: " + this.name + ".");
/// DEBUG
		return added;
	};

	/**
	 * Executes the attack plan, after this is executed the update function will be run every turn
	 * If we're here, it's because we have enough units.
	 * @return {boolean}
	 */
	m.AttackPlan.prototype.StartAttack = function (gameState) {
/// DEBUG
		gameState.ai.logger.push("WARNING", "AttackManager", "Starting " + this.type + " attack, plan " + this.name + "!");
/// DEBUG
		// if our target was destroyed during preparation, choose a new one
		if ((this.targetPlayer === undefined || !this.target || !gameState.getEntityById(this.target.id())) &&
			!this.chooseTarget(gameState)) {
/// DEBUG
			gameState.ai.logger.push("BUG", "AttackManager", "Our first target was destroyed, we tried to choose a new one, but failed! Terminating " + this.type + " attack, plan " + this.name + ".");
/// DEBUG
			return false;
		}


		// erase our queue. This will stop any leftover unit from being trained.
		gameState.ai.queueManager.removeQueue("plan_" + this.name);

		for (let ent of this.unitCollection.values()) {

			ent.setMetadata(PlayerID, "subrole", "walking");
			//let stance = ent.isPackable() ? "standground" : "aggressive";
			if (ent.getStance() !== "aggressive") // stance
				ent.setStance("aggressive");
		}

		if (this.type !== "Naval") {
/// DEBUG
			gameState.ai.logger.push("INFO", "AttackManager", "Transport check!");
/// DEBUG
			let rallyAccess = gameState.ai.accessibility.getAccessValue(this.rallyPoint);
			let targetAccess = m.getLandAccess(gameState, this.target);
			if (rallyAccess === targetAccess) {
				if (!this.path)
					this.getPathToTarget(gameState, true);
				if (!this.path || !this.path[0][0] || !this.path[0][1]) {
/// DEBUG
					gameState.ai.logger.push("BUG", "AttackManager", "Path generation failed. Terminating " + this.type + " attack, plan " + this.name + ".");
/// DEBUG
					return false;
				}
				this.overseas = 0;
				this.state = "walking";
				this.unitCollection.moveToRange(this.path[0][0], this.path[0][1], 0, 15);
			} else {
				this.overseas = gameState.ai.HQ.getSeaBetweenIndices(gameState, rallyAccess, targetAccess);
				if (!this.overseas) {
/// DEBUG
					gameState.ai.logger.push("BUG", "AttackManager", "Oversea check failed. Terminating " + this.type + " attack, plan " + this.name + ".");
/// DEBUG
					return false;
				}

				this.state = "transporting";
				// TODO require a global transport for the collection,
				// and put back its state to "walking" when the transport is finished
				for (let ent of this.unitCollection.values())
					gameState.ai.HQ.navalManager.requireTransport(gameState, ent, rallyAccess, targetAccess, this.targetPos);
			}
		} else {
			if (!this.path)
				this.getPathToTarget(gameState, true);
			if (!this.path || !this.path[0][0] || !this.path[0][1]) {
/// DEBUG
				gameState.ai.logger.push("BUG", "AttackManager", "Path generation failed. Terminating " + this.type + " attack, plan " + this.name + ".");
/// DEBUG
				return false;
			}

			this.state = "arrived";
			this.unitCollection.moveToRange(this.path[0][0], this.path[0][1], 0, 15);
		}
/// DEBUG
		gameState.ai.logger.push("WARNING", "AttackManager", this.type + " attack, plan " + this.name + " has started successfully!");
/// DEBUG
		return true;
	};

	/** Runs every turn after the attack is executed */
	m.AttackPlan.prototype.update = function (gameState, events) {
		// Stop current attack after turn limit, or a defeat
		if (gameState.ai.playedTurn - this.startTurn > this.turnLimit) {
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", this.type + " attack, plan " + this.name + " was terminated due to turn limit!");
/// DEBUG
			return 0;
		} else if (!this.unitCollection.hasEntities()
			|| (this.type === "Naval" && this.unitCollection.length < this.size)  // Protect ships
			|| (this.type !== "Raid" && this.unitCollection.length < 0.5 * this.size)) {
/// DEBUG
			gameState.ai.logger.push("WARNING", "AttackManager", this.type + " attack, plan " + this.name + " was terminated due to defeat!");
/// DEBUG
			return 0;
		}
///
		Engine.ProfileStart("Update Attack");
///
		this.position = this.unitCollection.getCentrePosition();

		// we are transporting our units, let's wait
		// TODO instead of state "arrived", made a state "walking" with a new path
		if (this.state === "transporting")
			this.UpdateTransporting(gameState, events);

		if (this.state === "walking" && !this.UpdateWalking(gameState, events)) {
			///
			Engine.ProfileStop();
			///
			return 0;
		}

		if (this.state === "arrived") {
			// let's proceed on with whatever happens now.
			this.state = "";
			this.startingAttack = true;
			this.unitCollection.forEach(ent => {
				ent.stopMoving();
				ent.setMetadata(PlayerID, "subrole", "attacking");
			});
			if (this.type === "Naval" || this.type === "Rush")   // Try to find a better target for naval and rush
			{
				let newtarget = this.getNearestTarget(gameState, this.position);
				if (newtarget) {
					this.target = newtarget;
					this.targetPos = this.target.position();
				}
			}
		}

		// basic state of attacking.
		if (this.state === "") {
			// First update the target and/or its position if needed
			if (!this.UpdateTarget(gameState)) {
				///
				Engine.ProfileStop();
				///
				return false;
			}

			let time = gameState.ai.elapsedTime;
			let attackedByStructure = {};
			for (let evt of events.Attacked) {
				if (!this.unitCollection.hasEntId(evt.target))
					continue;
				let attacker = gameState.getEntityById(evt.attacker);
				let ourUnit = gameState.getEntityById(evt.target);
				if (!ourUnit || !attacker || !attacker.position())
					continue;
				if (!attacker.hasClass("Unit")) {
					attackedByStructure[evt.target] = true;
					continue;
				}
				if (this.type !== "Naval") {
					if (m.isSiegeUnit(ourUnit)) {	// if our siege units are attacked, we'll send some units to deal with enemies.
						let collec = this.unitCollection.filter(API3.Filters.not(API3.Filters.byClass("Siege"))).filterNearest(ourUnit.position(), 5);
						for (let ent of collec.values()) {
							if (m.isSiegeUnit(ent))	// needed as mauryan elephants are not filtered out
								continue;
							ent.attack(attacker.id(), m.allowCapture(gameState, ent, attacker));
							ent.setMetadata(PlayerID, "lastAttackPlanUpdateTime", time);
						}
						// And if this attacker is a non-ranged siege unit and our unit also, attack it
						if (m.isSiegeUnit(attacker) && attacker.hasClass("Melee") && ourUnit.hasClass("Melee")) {
							ourUnit.attack(attacker.id(), m.allowCapture(gameState, ourUnit, attacker));
							ourUnit.setMetadata(PlayerID, "lastAttackPlanUpdateTime", time);
						}
					} else {
						if (this.isBlocked && !ourUnit.hasClass("Ranged") && attacker.hasClass("Ranged")) {
							// do not react if our melee units are attacked by ranged one and we are blocked by walls
							// TODO check that the attacker is from behind the wall

						} else if (m.isSiegeUnit(attacker)) {	// if our unit is attacked by a siege unit, we'll send some melee units to help it.
							let collec = this.unitCollection.filter(API3.Filters.byClass("Melee")).filterNearest(ourUnit.position(), 5);
							for (let ent of collec.values()) {
								ent.attack(attacker.id(), m.allowCapture(gameState, ent, attacker));
								ent.setMetadata(PlayerID, "lastAttackPlanUpdateTime", time);
							}
						} else if (ourUnit.position()) {
							// Look first for nearby units to help us if possible
							let collect = this.unitCollection.filterNearest(ourUnit.position(), 2);
							for (let ent of collect.values()) {
								if (m.isSiegeUnit(ent))
									continue;
								let orderData = ent.unitAIOrderData();
								if (orderData && orderData.length && orderData[0].target) {
									if (orderData[0].target === attacker.id())
										continue;
									let target = gameState.getEntityById(orderData[0].target);
									if (target && !target.hasClass("Structure") && !target.hasClass("Support"))
										continue;
								}
								ent.attack(attacker.id(), m.allowCapture(gameState, ent, attacker));
								ent.setMetadata(PlayerID, "lastAttackPlanUpdateTime", time);
							}
							// Then the unit under attack: abandon its target (if it was a structure or a support) and retaliate
							// also if our unit is attacking a range unit and the attacker is a melee unit, retaliate
							let orderData = ourUnit.unitAIOrderData();
							if (orderData && orderData.length && orderData[0].target) {
								if (orderData[0].target === attacker.id())
									continue;
								let target = gameState.getEntityById(orderData[0].target);
								if (target && !target.hasClass("Structure") && !target.hasClass("Support")) {
									if (!target.hasClass("Ranged") || !attacker.hasClass("Melee"))
										continue;
								}
							}
							ourUnit.attack(attacker.id(), m.allowCapture(gameState, ourUnit, attacker));
							ourUnit.setMetadata(PlayerID, "lastAttackPlanUpdateTime", time);
						}
					}
				}
			}

			let enemyUnits = gameState.getEnemyUnits(this.targetPlayer);
			let enemyStructures = gameState.getEnemyStructures(this.targetPlayer);

			// Count the number of times an enemy is targeted, to prevent all units to follow the same target
			let unitTargets = {};
			for (let ent of this.unitCollection.values()) {
				if (this.type !== "Naval" && ent.hasClass("Ship"))	// TODO What to do with ships
					continue;
				let orderData = ent.unitAIOrderData();
				if (!orderData || !orderData.length || !orderData[0].target)
					continue;
				let targetId = orderData[0].target;
				let target = gameState.getEntityById(targetId);
				if (!target || target.hasClass("Structure"))
					continue;
				if (!(targetId in unitTargets)) {
					if (this.type !== "Naval") {
						if (target.hasClass("Ship")) {
							unitTargets[targetId] = -3;
						} else {
							unitTargets[targetId] = 3;
						}
					} else {
						if (m.isSiegeUnit(target) || target.hasClass("Hero"))
							unitTargets[targetId] = -8;
						else if (target.hasClass("Champion") || target.hasClass("Ship"))
							unitTargets[targetId] = -5;
						else
							unitTargets[targetId] = -3;
					}
				}
				++unitTargets[targetId];
			}
			let veto = {};
			for (let target in unitTargets)
				if (unitTargets[target] > 0)
					veto[target] = true;

			let targetClassesUnit;
			let targetClassesSiege;
			if (this.type === "Rush")
				targetClassesUnit = {
					"attack": ["Unit", "Structure"],
					"avoid": ["Palisade", "StoneWall", "Tower", "Fortress"],
					"vetoEntities": veto
				};
			else {
				if (this.target.hasClass("Fortress"))
					targetClassesUnit = {
						"attack": ["Unit", "Structure"],
						"avoid": ["Palisade", "StoneWall"],
						"vetoEntities": veto
					};
				else if (this.target.hasClass("Palisade") || this.target.hasClass("StoneWall"))
					targetClassesUnit = {"attack": ["Unit", "Structure"], "avoid": ["Fortress"], "vetoEntities": veto};
				else
					targetClassesUnit = {
						"attack": ["Unit", "Structure"],
						"avoid": ["Palisade", "StoneWall", "Fortress"],
						"vetoEntities": veto
					};
			}
			if (this.target.hasClass("Structure"))
				targetClassesSiege = {"attack": ["Structure"], "avoid": [], "vetoEntities": veto};
			else
				targetClassesSiege = {"attack": ["Unit", "Structure"], "avoid": [], "vetoEntities": veto};

			// do not loose time destroying buildings which do not help enemy's defence and can be easily captured later
			if (this.target.hasDefensiveFire()) {
				targetClassesUnit.avoid = targetClassesUnit.avoid.concat("House", "Storehouse", "Farmstead", "Field", "Blacksmith");
				targetClassesSiege.avoid = targetClassesSiege.avoid.concat("House", "Storehouse", "Farmstead", "Field", "Blacksmith");
			}

			if (this.unitCollUpdateArray === undefined || !this.unitCollUpdateArray.length)
				this.unitCollUpdateArray = this.unitCollection.toIdArray();

			// Let's check a few units each time we update (currently 10) except when attack starts
			let lgth = this.unitCollUpdateArray.length < 15 || this.startingAttack ? this.unitCollUpdateArray.length : 10;
			for (let check = 0; check < lgth; check++) {
				let ent = gameState.getEntityById(this.unitCollUpdateArray[check]);
				if (!ent || !ent.position())
					continue;
				// Do not reaffect units which have reacted to an attack in that same turn
				if (ent.getMetadata(PlayerID, "lastAttackPlanUpdateTime") === time)
					continue;

				let targetId;
				let orderData = ent.unitAIOrderData();
				if (orderData && orderData.length && orderData[0].target)
					targetId = orderData[0].target;

				// update the order if needed
				let needsUpdate = false;
				let maybeUpdate = false;
				let siegeUnit = m.isSiegeUnit(ent);
				if (ent.isIdle())
					needsUpdate = true;
				else if (siegeUnit && targetId) {
					let target = gameState.getEntityById(targetId);
					if (!target || gameState.isPlayerAlly(target.owner()))
						needsUpdate = true;
					else if (unitTargets[targetId] && unitTargets[targetId] > 0) {
						needsUpdate = true;
						--unitTargets[targetId];
					} else if (!target.hasClass("Structure"))
						maybeUpdate = true;
				} else if (targetId) {
					let target = gameState.getEntityById(targetId);
					if (!target || gameState.isPlayerAlly(target.owner()))
						needsUpdate = true;
					else if (unitTargets[targetId] && unitTargets[targetId] > 0) {
						needsUpdate = true;
						--unitTargets[targetId];
					} else if (target.hasClass("Ship") && !ent.hasClass("Ship"))
						maybeUpdate = true;
					else if (attackedByStructure[ent.id()] && target.hasClass("Field"))
						maybeUpdate = true;
					else if (!ent.hasClass("Cavalry") && !ent.hasClass("Ranged") &&
						target.hasClass("FemaleCitizen") && target.unitAIState().split(".")[1] === "FLEEING")
						maybeUpdate = true;
				}

				// don't update too soon if not necessary
				if (!needsUpdate) {
					if (!maybeUpdate)
						continue;
					let deltat = ent.unitAIState() === "INDIVIDUAL.COMBAT.APPROACHING" ? 10 : 5;
					let lastAttackPlanUpdateTime = ent.getMetadata(PlayerID, "lastAttackPlanUpdateTime");
					if (lastAttackPlanUpdateTime && time - lastAttackPlanUpdateTime < deltat)
						continue;
				}
				ent.setMetadata(PlayerID, "lastAttackPlanUpdateTime", time);
				let range = 60;
				let attackTypes = ent.attackTypes();
				if (this.isBlocked) {
					if (attackTypes && attackTypes.indexOf("Ranged") !== -1)
						range = ent.attackRange("Ranged").max;
					else if (attackTypes && attackTypes.indexOf("Melee") !== -1)
						range = ent.attackRange("Melee").max;
					else
						range = 10;
				} else if (attackTypes && attackTypes.indexOf("Ranged") !== -1)
					range = 30 + ent.attackRange("Ranged").max;
				else if (ent.hasClass("Cavalry"))
					range += 30;
				range = range * range;
				let entAccess = m.getLandAccess(gameState, ent);
				// Checking for gates if we're a siege unit.
				if (siegeUnit) {
					let mStruct = enemyStructures.filter(enemy => {
						if (!enemy.position() || enemy.hasClass("StoneWall") && !ent.canAttackClass("StoneWall"))
							return false;
						if (API3.SquareVectorDistance(enemy.position(), ent.position()) > range)
							return false;
						if (enemy.foundationProgress() === 0)
							return false;
						return m.getLandAccess(gameState, enemy) === entAccess;

					}).toEntityArray();
					if (mStruct.length) {
						mStruct.sort((structa, structb) => {
							let vala = structa.costSum();
							if (structa.hasClass("Gates") && ent.canAttackClass("StoneWall"))
								vala += 10000;
							else if (structa.hasDefensiveFire())
								vala += 1000;
							else if (structa.hasClass("ConquestCritical"))
								vala += 200;
							let valb = structb.costSum();
							if (structb.hasClass("Gates") && ent.canAttackClass("StoneWall"))
								valb += 10000;
							else if (structb.hasDefensiveFire())
								valb += 1000;
							else if (structb.hasClass("ConquestCritical"))
								valb += 200;
							return valb - vala;
						});
						if (mStruct[0].hasClass("Gates"))
							ent.attack(mStruct[0].id(), m.allowCapture(gameState, ent, mStruct[0]));
						else {
							let rand = randIntExclusive(0, mStruct.length * 0.2);
							ent.attack(mStruct[rand].id(), m.allowCapture(gameState, ent, mStruct[rand]));
						}
					} else {
						if (!ent.hasClass("Ranged")) {
							let targetClasses = {
								"attack": targetClassesSiege.attack,
								"avoid": targetClassesSiege.avoid.concat("Ship"),
								"vetoEntities": veto
							};
							ent.attackMove(this.targetPos[0], this.targetPos[1], targetClasses);
						} else
							ent.attackMove(this.targetPos[0], this.targetPos[1], targetClassesSiege);
					}
				} else {
					let nearby = !ent.hasClass("Cavalry") && !ent.hasClass("Ranged");
					let mUnit = enemyUnits.filter(enemy => {
						if (!enemy.position())
							return false;
						if (enemy.hasClass("Animal"))
							return false;
						if (nearby && enemy.hasClass("FemaleCitizen") && enemy.unitAIState().split(".")[1] === "FLEEING")
							return false;
						let dist = API3.SquareVectorDistance(enemy.position(), ent.position());
						if (dist > range)
							return false;
						if (m.getLandAccess(gameState, enemy) !== entAccess)
							return false;
						// if already too much units targeting this enemy, let's continue towards our main target
						if (veto[enemy.id()] && API3.SquareVectorDistance(this.targetPos, ent.position()) > 2500)
							return false;
						enemy.setMetadata(PlayerID, "distance", Math.sqrt(dist));
						return true;
					}, this).toEntityArray();
					if (mUnit.length) {
						mUnit.sort((unitA, unitB) => {
							let vala = unitA.hasClass("Support") ? 50 : 0;
							if (ent.countersClasses(unitA.classes()))
								vala += 100;
							let valb = unitB.hasClass("Support") ? 50 : 0;
							if (ent.countersClasses(unitB.classes()))
								valb += 100;
							let distA = unitA.getMetadata(PlayerID, "distance");
							let distB = unitB.getMetadata(PlayerID, "distance");
							if (distA && distB) {
								vala -= distA;
								valb -= distB;
							}
							if (veto[unitA.id()])
								vala -= 20000;
							if (veto[unitB.id()])
								valb -= 20000;
							return valb - vala;
						});
						let rand = randIntExclusive(0, mUnit.length * 0.1);
						ent.attack(mUnit[rand].id(), m.allowCapture(gameState, ent, mUnit[rand]));
					} else if (this.isBlocked)
						ent.attack(this.target.id(), false);
					else if (API3.SquareVectorDistance(this.targetPos, ent.position()) > 2500) {
						let targetClasses = targetClassesUnit;
						if (maybeUpdate && ent.unitAIState() === "INDIVIDUAL.COMBAT.APPROACHING")	// we may be blocked by walls, attack everything
						{
							if (!ent.hasClass("Ranged") && !ent.hasClass("Ship"))
								targetClasses = {
									"attack": ["Unit", "Structure"],
									"avoid": ["Ship"],
									"vetoEntities": veto
								};
							else
								targetClasses = {"attack": ["Unit", "Structure"], "vetoEntities": veto};
						} else if (!ent.hasClass("Ranged") && !ent.hasClass("Ship"))
							targetClasses = {
								"attack": targetClassesUnit.attack,
								"avoid": targetClassesUnit.avoid.concat("Ship"),
								"vetoEntities": veto
							};
						ent.attackMove(this.targetPos[0], this.targetPos[1], targetClasses);
					} else {
						let mStruct = enemyStructures.filter(enemy => {
							if (this.isBlocked && enemy.id() !== this.target.id())
								return false;
							if (!enemy.position() || enemy.hasClass("StoneWall") && !ent.canAttackClass("StoneWall"))
								return false;
							if (API3.SquareVectorDistance(enemy.position(), ent.position()) > range)
								return false;
							return m.getLandAccess(gameState, enemy) === entAccess;

						}, this).toEntityArray();
						if (mStruct.length) {
							mStruct.sort((structa, structb) => {
								let vala = structa.costSum();
								if (structa.hasClass("Gates") && ent.canAttackClass("StoneWall"))
									vala += 10000;
								else if (structa.hasClass("ConquestCritical"))
									vala += 100;
								let valb = structb.costSum();
								if (structb.hasClass("Gates") && ent.canAttackClass("StoneWall"))
									valb += 10000;
								else if (structb.hasClass("ConquestCritical"))
									valb += 100;
								return valb - vala;
							});
							if (mStruct[0].hasClass("Gates"))
								ent.attack(mStruct[0].id(), false);
							else {
								let rand = randIntExclusive(0, mStruct.length * 0.2);
								ent.attack(mStruct[rand].id(), m.allowCapture(gameState, ent, mStruct[rand]));
							}
						} else if (needsUpdate)  // really nothing   let's try to help our nearest unit
						{
							let distmin = Math.min();
							let attacker;
							this.unitCollection.forEach(unit => {
								if (!unit.position())
									return;
								if (unit.unitAIState().split(".")[1] !== "COMBAT" || !unit.unitAIOrderData().length ||
									!unit.unitAIOrderData()[0].target)
									return;
								if (!gameState.getEntityById(unit.unitAIOrderData()[0].target))
									return;
								let dist = API3.SquareVectorDistance(unit.position(), ent.position());
								if (dist > distmin)
									return;
								distmin = dist;
								attacker = gameState.getEntityById(unit.unitAIOrderData()[0].target);
							});
							if (attacker)
								ent.attack(attacker.id(), m.allowCapture(gameState, ent, attacker));
						}
					}
				}
			}
			this.unitCollUpdateArray.splice(0, lgth);
			this.startingAttack = false;

			// ARCH: Clear Gaia units & structures instead of stopping the attack!
			// check if this enemy has resigned
			/*if (this.target && this.target.owner() === 0 && this.targetPlayer !== 0)
				this.target = undefined;*/

		}
		this.lastPosition = this.position;
///
		Engine.ProfileStop();
///
		return this.unitCollection.length;
	};
///
	m.AttackPlan.prototype.Serialize = function () {
		let properties = {
			"name": this.name,
			"type": this.type,
			"state": this.state,
			"forced": this.forced,
			"rallyPoint": this.rallyPoint,
			"overseas": this.overseas,
			"paused": this.paused,
			"maxCompletingTime": this.maxCompletingTime,
			"siegeState": this.siegeState,
			"lastPosition": this.lastPosition,
			"position": this.position,
			"isBlocked": this.isBlocked,
			"targetPlayer": this.targetPlayer,
			"target": this.target !== undefined ? this.target.id() : undefined,
			"targetPos": this.targetPos,
			"uniqueTargetId": this.uniqueTargetId,
			"path": this.path
		};

		return {"properties": properties};
	};

	m.AttackPlan.prototype.Deserialize = function (gameState, data) {
		for (let key in data.properties)
			this[key] = data.properties[key];

		if (this.target)
			this.target = gameState.getEntityById(this.target);

		this.failed = undefined;
	};
///
	return m;
}(ARCH);
