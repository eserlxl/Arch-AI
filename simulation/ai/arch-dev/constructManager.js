let ARCH = function (m) {

	m.ConstructManager = function (Config) {
		this.Config = Config;
		this.maxPriority = Config.priorities["wonder"];

		this.mainType = {
			"CivCentre": "civilCentre",
			"Colony": "civilCentre",
			"House": "house",
			"Field": "field",
			"Farmstead": "farmStead",
			"Corral": "corral",
			"Storehouse": "dropsite",
			"BarterMarket": "market",
			"Dock": "dock",
			"Temple": "temple",
			"Barracks": "military",
			"Archery": "military",
			"Stables": "military",
			"Workshop": "military",
			"Blacksmith": "military",
			"ElephantStables": "military",
			"Fortress": "defence",
			"SentryTower": "defence",
			"StoneTower": "defence",
			"Wonder": "wonder"
		};

		this.count = {};
		this.prevCount = {};
		this.maxCount = {};
		this.buildTryCount = {};

		for (let type in this.mainType) {
			this.count[type] = 0;
			this.prevCount[type] = -1;
			this.maxCount[type] = 0;
			this.buildTryCount[type] = 0;
		}

		this.target = this.Config.Base.target;

		/// Unitary
		this.maxBaseCount = 1;
		/// Unitary

		this.newBaseTargetResource = "wood";

		this.baseCount = 0;
		this.basicMilitaryBaseCount = 0;
		this.baseExpansionSafe = true;
		this.baseExpansionRatio = 0;
		this.baseExpansionRatioSafe = 0;

		this.dockBuildable = false;
		this.checkDock = false;
	};

	m.ConstructManager.prototype.init = function (gameState) {
	};

	m.ConstructManager.prototype.update = function (gameState, queues) {

		this.queueLimit = {};
		for (let type in this.mainType) {
			this.queueLimit[this.mainType[type]] = 1;
		}
		this.queueLimit["house"] = 1;
		this.queueLimit["military"] = 2 + gameState.getPopulation() / 50;
		this.queueLimit["defence"] = 1 + gameState.getPopulation() / 50;

		this.currentPhase = gameState.currentPhase();
		this.baseManagers = gameState.ai.HQ.baseManagers;
		this.baseManager = this.baseManagers[this.baseManagers.length - 1];
		this.buildManager = gameState.ai.HQ.buildManager;
		this.numActiveBases = gameState.ai.HQ.numActiveBases();
		this.population = gameState.getPopulation();
		this.bAdvanced = gameState.ai.HQ.bAdvanced;

		this.resource = gameState.getResources();

		this.resourceScarcity = gameState.ai.HQ.resourceManager.scarcity({
			"wood": this.Config.Economy.expectedResource["wood"],
			"stone": this.Config.Economy.expectedResource["stone"]
		});

		this.Building(gameState, queues);
		this.AdvancedBuilding(gameState, queues);
	};

	m.ConstructManager.prototype.setQueuePriority = function (gameState, targetQueue, gain = 1) {
		gameState.ai.queueManager.changePriority(targetQueue,
			Math.min(this.maxPriority, gain * gameState.ai.Config.priorities[targetQueue]));
	};

	m.ConstructManager.prototype.immediateConstruct = function (gameState, targetQueue) {
		let i = 0;
		for (let queue in this.queueLimit) {
			if (queue !== "civilCentre" && queue !== targetQueue) {
				gameState.ai.queueManager.changePriority(queue, 1);
			}
			i++;
		}
		if (this.maxPriority > this.Config.priorities[targetQueue])
			this.setQueuePriority(gameState, targetQueue, this.maxPriority);
	};

	m.ConstructManager.prototype.canBuild = function (gameState, structure, buildManager, numActiveBases) {
		if (buildManager === undefined) {
			buildManager = this.buildManager;
		}
		if (numActiveBases === undefined) {
			numActiveBases = this.numActiveBases;
		}
/// DEBUG
		gameState.ai.logger.push("DEBUG", "ConstructManager", "Checking buildability: " + structure);
/// DEBUG
		let type = gameState.applyCiv(structure);
		if (buildManager.isUnbuildable(gameState, type)) {
/// DEBUG
			gameState.ai.logger.push("DEBUG", "ConstructManager", structure + " is unbuildable!");
/// DEBUG
			return false;
		}

		if (gameState.isTemplateDisabled(type)) {
			buildManager.setUnbuildable(gameState, type, Infinity, "disabled");
/// DEBUG
			gameState.ai.logger.push("DEBUG", "ConstructManager", structure + " template was disabled!");
/// DEBUG
			return false;
		}

		let template = gameState.getTemplate(type);
		if (!template) {
			buildManager.setUnbuildable(gameState, type, Infinity, "notemplate");
/// DEBUG
			gameState.ai.logger.push("DEBUG", "ConstructManager", structure + " has no template!");
/// DEBUG
			return false;
		}

		if (!template.available(gameState)) {
			buildManager.setUnbuildable(gameState, type, 30, "tech");
/// DEBUG
			gameState.ai.logger.push("DEBUG", "ConstructManager", "Required technology for " + structure + " is unavailable!");
/// DEBUG
			return false;
		}

		if (!buildManager.hasBuilder(type)) {
			buildManager.setUnbuildable(gameState, type, 120, "nobuilder");
/// DEBUG
			gameState.ai.logger.push("DEBUG", "ConstructManager", structure + " has no builder!");
/// DEBUG
			return false;
		}

		if (numActiveBases < 1) {
			// if no base, check that we can build outside our territory
			let buildTerritories = template.buildTerritories();
			if (buildTerritories && (!buildTerritories.length || buildTerritories.length === 1 && buildTerritories[0] === "own")) {
				buildManager.setUnbuildable(gameState, type, 180, "room");
/// DEBUG
				gameState.ai.logger.push("DEBUG", "ConstructManager", "There is not enough space to build " + structure);
/// DEBUG
				return false;
			}
		}

		// build limits
		let limits = gameState.getEntityLimits();
		let category = template.buildCategory();
		if (category && limits[category] !== undefined && gameState.getEntityCounts()[category] >= limits[category]) {
			this.buildManager.setUnbuildable(gameState, type, 90, "limit");
/// DEBUG
			gameState.ai.logger.push("DEBUG", "ConstructManager", "The building limit for " + structure + " has already been reached!");
/// DEBUG
			return false;
		}

		return true;
	};

	m.ConstructManager.prototype.queue = function (gameState, queues, type, template, metadata, emergency, queueName, position) {

		let plan = new m.ConstructionPlan(gameState, type, template, metadata, position);

		plan.queueToReset = queueName; // Test

		if (emergency) {
			gameState.ai.HQ.buildManager.setBuildable(gameState.applyCiv(template));
			this.immediateConstruct(gameState, queueName);
		}

		for (let queueHash in this.queueLimit) {
			if (queueHash === queueName) {
				let queueObject = queues[queueName];
				let queueArray = Object(queueObject);
				let numPlanned = queueArray["plans"].length;
				if (numPlanned < this.queueLimit[queueName]) {
					queueObject.addPlan(plan);

					if (this.prevCount[type] < this.count[type] || this.buildTryCount[type] > 10) {
						this.buildTryCount[type] = 0;
						this.Config.Base.plan[type] = 0;
					} else if (this.buildTryCount[type] > 9) {
						this.Config.Base.plan[type] = 1;
					}
					this.prevCount[type] = this.count[type];

					this.buildTryCount[type]++;
				}
				break;
			}
		}
	};

	m.ConstructManager.prototype.Building = function (gameState, queues) {

		for (let type in this.mainType) {
			this.count[type] = gameState.getOwnEntitiesByClass(type, true).length;

			if (this.maxCount[type] < this.count[type]) {
				this.maxCount[type] = this.count[type];
			}
		}

		let template = {
			"CivCentre": "structures/{civ}_civil_centre",
			"Colony": "structures/{civ}_military_colony",
			"House": "structures/{civ}_house",
			"Field": "structures/{civ}_field",
			"Farmstead": "structures/{civ}_farmstead",
			"Corral": "structures/{civ}_corral",
			"Storehouse": "structures/{civ}_storehouse",
			"BarterMarket": "structures/{civ}_market",
			"Dock": "structures/{civ}_dock",
			"Temple": "structures/{civ}_temple",
			"Barracks": "structures/{civ}_barracks",
			"Archery": "structures/{civ}_range",
			"Stables": "structures/{civ}_stables",
			"Workshop": "structures/{civ}_workshop",
			"Blacksmith": "structures/{civ}_blacksmith",
			"ElephantStables": "structures/{civ}_elephant_stables",
			"Fortress": "structures/{civ}_fortress",
			"SentryTower": "structures/{civ}_sentry_tower",
			"StoneTower": "structures/{civ}_defense_tower",
			"Wonder": "structures/{civ}_wonder"
		};

		template["Stables"] = !gameState.isTemplateDisabled("structures/{civ}_stables") ? "structures/{civ}_stables" :
			!gameState.isTemplateDisabled("structures/{civ}_stable") ? "structures/{civ}_stable" : undefined;

		if (this.canBuild(gameState, "structures/{civ}_temple_vesta"))
			template["Temple"] = "structures/{civ}_temple_vesta";

		if (gameState.ai.HQ.canBuild(gameState, "structures/{civ}_super_dock"))
			template["Dock"] = "structures/{civ}_super_dock";
		else if (gameState.ai.HQ.canBuild(gameState, "structures/{civ}_shipyard"))
			template["Dock"] = "structures/{civ}_shipyard";

		let popRatio = this.population / Math.max(1, gameState.getPopulationLimit() - 5); // -5 for maxTrainingQueue size
		let housingCap = gameState.getPopulationLimit() === gameState.getPopulationMax() ? 0 : gameState.getPopulationMax() / 5;  // TODO: Check civ housing bonus

		let metadata = {
			// TODO: Check resource types
			"CivCentre": {"base": -1, "resource": this.newBaseTargetResource}, // base "-1" means new base.
			"Colony": {"base": -1, "resource": this.newBaseTargetResource}, // base "-1" means new base.
			"House": undefined,
			"Field": {"favoredBase": this.ID},
			"Farmstead": undefined,
			"Corral": {"favoredBase": this.ID},
			"Storehouse": {"base": this.ID, "type": "wood"}, // TODO: Check resource types
			"BarterMarket": undefined,
			"Dock": undefined,
			"Temple": undefined,
			"Barracks": {"militaryBase": true},
			"Archery": {"militaryBase": true},
			"Stables": {"militaryBase": true},
			"Workshop": {"militaryBase": true},
			"Blacksmith": undefined,
			"ElephantStables": {"militaryBase": true},
			"Fortress": undefined,
			"SentryTower": undefined,
			"StoneTower": undefined,
			"Wonder": undefined
		};

		let position = {};
		for (let type in this.mainType) {
			position[type] = undefined;
		}

		this.baseCount = this.count["CivCentre"] + this.count["Colony"];
		this.basicMilitaryBaseCount = this.count["Barracks"] + this.count["Archery"];
		let limit = {
			"CivCentre": this.target["CivCentre"],
			"Colony": this.target["Colony"],
			"House": Math.min(housingCap, Math.max(1, 0.25 * (1 + this.currentPhase < 2) + 1.05 * popRatio) * Math.max(1, this.count["House"])),
			"Field": this.target["Field"],
			"Farmstead": Math.min(2, this.currentPhase),
			"Corral": Math.min(2, this.currentPhase),
			"Storehouse": this.currentPhase,
			"BarterMarket": (this.currentPhase + this.baseCount - 1) * (m.checkPhase(gameState, 2) && this.basicMilitaryBaseCount > 1), // Build two markets after having enough basic military bases
			"Dock": this.currentPhase,
			"Temple": (this.basicMilitaryBaseCount > 1) * this.currentPhase - 1,
			"Barracks": this.currentPhase,
			"Archery": this.currentPhase,
			"Stables": this.currentPhase,
			"Workshop": m.checkPhase(gameState, 3),
			"Blacksmith": Math.min(2, this.currentPhase),
			"ElephantStables": this.currentPhase * m.checkPhase(gameState, 2),
			"Fortress": this.currentPhase * m.checkPhase(gameState, 3),
			"SentryTower": (this.currentPhase < 2) * Math.max(this.basicMilitaryBaseCount, 2),
			"StoneTower": Math.max(this.basicMilitaryBaseCount, 3),
			"Wonder": m.checkPhase(gameState, 3)
		};

		for (let type in this.target) {
			this.target[type] = limit[type] * (1 + this.Config.Base.expansionRate[type] * this.baseExpansionRatioSafe / Math.max(this.count[type] + 1));
			// Reconstruction of destroyed buildings
			this.target[type] = Math.max(this.maxCount[type], this.target[type]);

			if (!(this.baseCount < 1 && type === "CivCentre")
				|| type === "House" || type === "Field" || type === "Wonder" || type === "Dock" || type === "BarterMarket") {
				continue;
			}
			this.target[type] /= (1 + this.buildTryCount[type]);
		}

		// Field count should be limited against to the base expansion mechanism
		this.target["Field"] = Math.min(this.Config.Economy.maxFieldCount, this.target["Field"]);

		// Rush Protection
		if (gameState.ai.playedTurn < gameState.ai.Config.Defence.rushProtectionTurn
			|| (this.currentPhase > 1 && this.count["BarterMarket"] < 1)) {
			if (gameState.ai.HQ.resourceManager.idleWorkers < 3) {
				this.target["Field"] = 4;
			}
			this.target["Barracks"] = Math.min(2, this.count["House"] / 6);
			this.target["Archery"] = Math.min(2, this.count["House"] / 6);
			this.target["Farmstead"] = 0;
			this.target["Corral"] = 0;
		}

		/// Communist
		this.target["Temple"] = 0;
		/// Communist

		/// Theocrat
		this.target["Temple"] *= 2;
		// TODO: Add pyramid and library bonus to Theocrat AI
		/// Theocrat

		for (let type in this.target) {
			this.target[type] = Math.min(this.count[type] + 10, this.target[type]);
		}

		this.baseExpansionRatio = gameState.ai.elapsedTime / 30. * popRatio;

		// Base completion check
		this.baseExpansionSafe = true;
		for (let type in this.mainType) {
			let expectedMinCount = Math.max(2, 0.5 * this.target[type]);
			if (this.count[type] < expectedMinCount
				&& this.mainType[type] !== "civilCentre"
				&& type !== "Dock"
				&& type !== "SentryTower"
				&& type !== "Wonder"
				&& this.canBuild(gameState, template[type])) {
				this.baseExpansionSafe = false;
				this.baseExpansionRatio = this.baseExpansionRatioSafe;
				this.baseExpansionRatioSafe *= 0.999;

/// DEBUG
				gameState.ai.logger.push("DEBUG", "ConstructManager", "Build more " + type + "s count: " + this.count[type] + " expected: " + expectedMinCount);
/// DEBUG
				break;
			}
		}

		if (this.baseExpansionSafe) {
			this.baseExpansionRatioSafe = this.baseExpansionRatio;
		}

/// DEBUG
		gameState.ai.logger.push("DEBUG", "ConstructManager", "BaseExpSafe?: " + this.baseExpansionSafe + " BaseExpRatioSafe: " + this.baseExpansionRatioSafe + " BaseExpRatio: " + this.baseExpansionRatio);
/// DEBUG

		// Reducing computations for Storehouse and Dock
		position["Storehouse"] = false;
		if (this.count["Storehouse"] < this.target["Storehouse"]) {
			let resourceType = ["wood", "stone", "metal"];
			position["Storehouse"] = this.baseManager.findBestDropsiteLocation(gameState, resourceType[this.count["Storehouse"] % resourceType.length]).pos;
		}

		position["Dock"] = false;
		if (!this.dockBuildable && this.checkDock) {
			this.target["Dock"] = 0;
		} else if (this.count["Dock"] < this.target["Dock"] && !queues.dock.hasQueuedUnits()) {
			this.dockMetaData = this.checkSea(gameState);
			metadata["Dock"] = this.planBuildDock(gameState);
			if (metadata["Dock"]) {
				let tempPlan = new m.ConstructionPlan(gameState, "Dock", template["Dock"], metadata["Dock"]);
				position["Dock"] = tempPlan.findDockPosition(gameState, 32);
			}
		}

/// DEBUG
		gameState.ai.logger.push("DEBUG", "ConstructManager", "Dock metadata " + uneval(metadata["Dock"]) + " pos: " + position["Dock"] + " navalMap: " + gameState.ai.HQ.navalMap + " dockBuildable: " + this.dockBuildable + " count " + this.count["Dock"] + " target " + this.target["Dock"]);
/// DEBUG

		// TODO: Add more buildings or phase list if we have new phases
		let phaseUpType = {};

		if (this.dockBuildable) {
			phaseUpType = {
				1: ["Corral", "Dock", "Storehouse"],
				2: ["BarterMarket", "Corral", "Dock", "Storehouse", "Farmstead", "Stables", "ElephantStables", "StoneTower", "Temple", "Blacksmith"],
				3: ["BarterMarket", "Corral", "Dock", "Storehouse", "Farmstead", "Fortress", "Stables", "ElephantStables", "StoneTower", "Temple", "Blacksmith", "Workshop"],
			};
		} else {
			phaseUpType = {
				1: ["Corral", "Storehouse", "Farmstead"],
				2: ["BarterMarket", "Corral", "Storehouse", "Farmstead", "Stables", "ElephantStables", "StoneTower", "Temple", "Blacksmith"],
				3: ["BarterMarket", "Corral", "Storehouse", "Farmstead", "Fortress", "Stables", "ElephantStables", "StoneTower", "Temple", "Blacksmith", "Workshop"],
			};
		}

		// Delist old tech buildings
		if (m.checkPhase(gameState, 2)) {
			this.target["SentryTower"] = 0;
		}

		// Build a new house only when necessary
		if (popRatio < 0.8 || this.count["House"] > housingCap) {
			this.target["House"] = 0;
		}

/// Unitary
		this.target["CivCentre"] = 1;
		this.target["Colony"] = 0;
/// Unitary

		let emergencyOrder = false;
		if (this.baseCount >= 1) {
			if (this.count["House"] < this.target["House"] && (popRatio > 0.85 || this.baseExpansionRatio > 1)) {
				// Try to improve housing technology
				gameState.ai.HQ.researchManager.researchPopulationBonus(gameState, queues);
				emergencyOrder = "House";
			} else if (this.count["Field"] < this.target["Field"] && (this.count["Field"] < 4 || this.basicMilitaryBaseCount > 1)) {
				emergencyOrder = "Field";
				if (Math.max(1, this.count["Farmstead"]) * 4 < this.count["Field"] + 1) {
					emergencyOrder = "Farmstead";
				}
			} else if (this.basicMilitaryBaseCount < Math.min(2, this.target["Barracks"] + this.target["Archery"])) {
				let basicMilitaryBase = ["Barracks", "Archery"];
				for (let i = 0; i < basicMilitaryBase.length; i++) {
					if (this.canBuild(gameState, template[basicMilitaryBase[i]])) {
						emergencyOrder = basicMilitaryBase[i];
						break;
					}
				}
			} else if (gameState.ai.HQ.trainingManager.mainWorkerCount > 35) {
				let list = phaseUpType[this.currentPhase];
				for (let i = 0; i < list.length; i++) {
					if (this.canBuild(gameState, template[list[i]]) && this.target[list[i]] > 0 && this.count[list[i]] < Math.min(2, this.currentPhase)) {
						emergencyOrder = list[i];
						break;
					}
				}
			}
		} else {
			emergencyOrder = "CivCentre";
		}

		// Immediately build necessary structures
		if (emergencyOrder) {
			this.queue(gameState, queues, emergencyOrder, template[emergencyOrder], metadata[emergencyOrder], true, this.mainType[emergencyOrder], position[emergencyOrder]);
/// DEBUG
			gameState.ai.logger.push("WARNING", "ConstructManager", "Build a new " + emergencyOrder + " immediately! Count: " + this.count[emergencyOrder]);
/// DEBUG
			return;
		}

		let emergency = {};
		for (let type in this.mainType) {
			emergency[type] = this.count[type] < this.target[type];
		}

		// Find the most required building
		let maxReq = 0;
		let maxReqType;
		for (let type in this.mainType) {

			if (emergency[type]) {
				gameState.ai.HQ.buildManager.setBuildable(gameState.applyCiv(template[type]));
			}

			if (position[type] !== false && this.canBuild(gameState, template[type])) {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "ConstructManager", " Trying to build " + type);
/// DEBUG
				let diff = this.target[type] - this.count[type];
				if (maxReq < diff) {
					maxReq = diff;
					maxReqType = type;
				}
			}

/// DEBUG
			gameState.ai.logger.push("DEBUG", "ConstructManager", "Checking construction details for " + type + "!" +
				" Count: " + this.count[type] +
				" Target: " + this.target[type] +
				" MaxCount: " + this.maxCount[type] +
				" TryCount: " + this.buildTryCount[type] +
				" Emergency: " + emergency[type] +
				" Pos: " + position[type] +
				" CanBuild? " + this.canBuild(gameState, template[type]));

			if (maxReqType) {
				gameState.ai.logger.push("DEBUG", "ConstructManager", " MaxReq: " + maxReq +
					" maxReqType: " + maxReqType);
			}
/// DEBUG
		}

		if (maxReq >= 1 && this.count[maxReqType] < this.target[maxReqType]
			&& (this.resource["wood"] > this.Config.Economy.expectedResource["wood"] || m.checkPhase(gameState, 2) || emergency[maxReqType])) {
/// DEBUG
			gameState.ai.logger.push("DEBUG", "ConstructManager", "Build a new " + maxReqType + "!" +
				" Count: " + this.count[maxReqType] +
				" Target: " + this.target[maxReqType] +
				" MaxCount: " + this.maxCount[maxReqType] +
				" TryCount: " + this.buildTryCount[maxReqType]);
/// DEBUG
			this.queue(gameState, queues, maxReqType, template[maxReqType], metadata[maxReqType], emergency[maxReqType], this.mainType[maxReqType], position[maxReqType]);
		}
	};

	m.ConstructManager.prototype.checkSea = function (gameState) {
		this.checkDock = true;
		let metadata = [];
		for (let base of gameState.ai.HQ.baseManagers) {
			if (!base.anchor || base.constructing)
				continue;
			let remaining = gameState.ai.HQ.navalManager.getUnconnectedSeas(gameState, base.accessIndex);

			for (let sea of remaining) {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "ConstructManager", "Checking Sea Index: " + sea + " Size: " + gameState.ai.accessibility.regionSize[sea]);
/// DEBUG
				if (gameState.ai.accessibility.regionSize[sea] < 16000) // Min. Lake/Sea Area to build a dock
					continue;

				let wantedLand = {};
				wantedLand[base.accessIndex] = true;

				this.dockBuildable = true;
				gameState.ai.HQ.navalMap = true;

				metadata.push({
					"land": wantedLand,
					"sea": sea,
					"size": gameState.ai.accessibility.regionSize[sea]
				});
			}
		}
		return metadata;
	};

	m.ConstructManager.prototype.planBuildDock = function (gameState) {
		let ownEntities = [];
		for (let ent of gameState.getOwnEntities().values()) {
			ownEntities.push(ent)
		}
		// We first choose as startingPoint the point where we have more dominance
		let startingPoint = [];
		for (let seaData in this.dockMetaData) {
			let seaIndex = this.dockMetaData[seaData]["sea"];

			let searchUniverse = ownEntities;

			for (let dPos = 10; dPos > 0.75; dPos /= 2) {
				let nextUniverse = [];

				let minTryCount = 1e6;
				for (let ent of searchUniverse) {
					let pos = ent.position();
					if (!pos) {
						continue;
					}

					let gamepos = gameState.ai.accessibility.gamePosToMapPos(pos);
					let index = gamepos[0] + gamepos[1] * gameState.ai.accessibility.width;

					let tryCount = 0;
					if (index < seaIndex) {
						while (index < seaIndex && gamepos[1] < gameState.ai.accessibility.height) {
							gamepos[0] += dPos;
							if (gamepos[0] >= gameState.ai.accessibility.width) {
								gamepos[0] = 0;
								gamepos[1] += dPos;
							}
							index = gamepos[0] + gamepos[1] * gameState.ai.accessibility.width;
							tryCount++;
						}
					} else {
						while (index > seaIndex && gamepos[1] >= 0) {
							gamepos[0] -= dPos;
							if (gamepos[0] < 0) {
								gamepos[0] = 0;
								gamepos[1] -= dPos;
							}
							index = gamepos[0] + gamepos[1] * gameState.ai.accessibility.width;
							tryCount++;
						}
					}

					if (tryCount < minTryCount) {
						minTryCount = tryCount;
						nextUniverse.push(ent);
						startingPoint.push({
							"dPos": dPos,
							"sea": seaIndex,
							"pos": pos,
							"index": index,
							"cost": tryCount * Math.pow(dPos, 2)
						});
					}
				}
				if (searchUniverse.length < 2) {
					break;
				}
				searchUniverse = nextUniverse;
			}
		}
/// DEBUG
		gameState.ai.logger.push("DEBUG", "ConstructManager", "Possible starting points for Dock: " + uneval(startingPoint));
/// DEBUG

		if (!startingPoint.length) {
			return false;
		} else {
			let minCostIndex = 0;
			for (let i = 1; i < startingPoint.length; ++i)
				if (startingPoint[i].cost < startingPoint[minCostIndex].cost)
					minCostIndex = i;

			let sea = startingPoint[minCostIndex].sea > 1 ? startingPoint[minCostIndex].sea : undefined;

			return {
				"sea": sea,
				"proximity": startingPoint[minCostIndex].pos
			};
		}
	};

	/**
	 * Deals with constructing advanced buildings
	 */
	m.ConstructManager.prototype.AdvancedBuilding = function (gameState, queues) {
		if (this.resourceScarcity && !this.canBarter || queues.militaryBuilding.hasQueuedUnits())
			return;

		if (this.resourceScarcity)
			return;

		if (this.currentPhase < 3)
			return;

		if (this.population < 80 || !this.bAdvanced.length)
			return;

		// Build advanced military buildings
		let nAdvanced = 0;
		for (let advanced of this.bAdvanced)
			nAdvanced += gameState.countEntitiesAndQueuedByType(advanced, true);

		if (!nAdvanced || nAdvanced < this.bAdvanced.length && this.population > 110) {
			for (let advanced of this.bAdvanced) {
				if (gameState.countEntitiesAndQueuedByType(advanced, true) > 0 || !this.canBuild(gameState, advanced))
					continue;
				let template = gameState.getTemplate(advanced);
				if (!template)
					continue;
				let civ = gameState.getPlayerCiv();
				if (template.hasDefensiveFire() || template.trainableEntities(civ))
					queues.militaryBuilding.addPlan(new m.ConstructionPlan(gameState, "AdvancedMilitary", advanced, {"militaryBase": true}));
				else	// not a military building, but still use this queue
					queues.militaryBuilding.addPlan(new m.ConstructionPlan(gameState, "AdvancedBuilding", advanced));
				return;
			}
		}
	};

	///
	m.ConstructManager.prototype.Serialize = function () {
		return {
			"test": true
		};
	};

	m.ConstructManager.prototype.Deserialize = function (gameState, data) {
		for (let key in data) {
			this[key] = data[key];
		}
	};
	///
	return m;

}(ARCH);
