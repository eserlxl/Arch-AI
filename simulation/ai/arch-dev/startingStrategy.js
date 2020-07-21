let ARCH = function (m) {
	/**
	 * determines the strategy to adopt when starting a new game, depending on the initial conditions
	 */

	m.HQ.prototype.gameAnalysis = function (gameState) {
		// Analysis of the terrain and the different access regions
		if (!this.regionAnalysis(gameState))
			return;

		this.attackManager.init(gameState);
		this.buildManager.init(gameState);
		this.navalManager.init(gameState);
		this.tradeManager.init(gameState);
		this.diplomacyManager.init(gameState);

		// Make a list of buildable structures from the config file
		this.structureAnalysis(gameState);

		// Let's get our initial situation here.
		let nobase = new m.BaseManager(gameState, this.Config);
		nobase.init(gameState);
		nobase.accessIndex = 0;
		this.baseManagers.push(nobase);   // baseManagers[0] will deal with unit/structure without base
		let ccEnts = gameState.getOwnStructures().filter(API3.Filters.byClass("CivCentre"));
		for (let cc of ccEnts.values())
			if (cc.foundationProgress() === undefined)
				this.createBase(gameState, cc);
			else
				this.createBase(gameState, cc, "unconstructed");
		this.updateTerritories(gameState);

		// Assign entities and resources in the different bases
		this.assignStartingEntities(gameState);

		// If no base yet, check if we can construct one. If not, dispatch our units to possible tasks/attacks
		this.canBuildUnits = true;
		if (!gameState.getOwnStructures().filter(API3.Filters.byClass("CivCentre")).hasEntities()) {
			let template = gameState.applyCiv("structures/{civ}_civil_centre");
			if (!gameState.isTemplateAvailable(template) || !gameState.getTemplate(template).available(gameState)) {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "StartingStrategy", "This AI is unable to produce any units.");
/// DEBUG
				this.canBuildUnits = false;
				this.dispatchUnits(gameState);
			} else
				this.buildFirstBase(gameState);
		}

		// configure our first base strategy
		if (this.baseManagers.length > 1)
			this.configFirstBase(gameState);
	};

	/**
	 * Assign the starting entities to the different bases
	 */
	m.HQ.prototype.assignStartingEntities = function (gameState) {
		for (let ent of gameState.getOwnEntities().values()) {
			// do not affect merchant ship immediately to trade as they may-be useful for transport
			if (ent.hasClass("Trader") && !ent.hasClass("Ship"))
				this.tradeManager.assignTrader(ent);

			let pos = ent.position();
			if (!pos) {
/// DEBUG
				// TODO should support recursive garrisoning. Make a warning for now
				if (ent.isGarrisonHolder() && ent.garrisoned().length) {
					gameState.ai.logger.push("BUG", "StartingStrategy", "Support for garrisoned units inside garrisoned holders not yet implemented.");
				}
/// DEBUG
				continue;
			}

			// make sure we have not rejected small regions with units (TODO should probably also check with other non-gaia units)
			let gamepos = gameState.ai.accessibility.gamePosToMapPos(pos);
			let index = gamepos[0] + gamepos[1] * gameState.ai.accessibility.width;
			let land = gameState.ai.accessibility.landPassMap[index];
			if (land > 1 && !this.landRegions[land])
				this.landRegions[land] = true;
			let sea = gameState.ai.accessibility.navalPassMap[index];
			if (sea > 1 && !this.navalRegions[sea])
				this.navalRegions[sea] = gameState.ai.accessibility.regionSize[sea];

			// if garrisoned units inside, ungarrison them except if a ship in which case we will make a transport
			// when a construction will start (see createTransportIfNeeded)
			if (ent.isGarrisonHolder() && ent.garrisoned().length && !ent.hasClass("Ship"))
				for (let id of ent.garrisoned())
					ent.unload(id);

			let bestbase;
			let territorypos = this.territoryMap.gamePosToMapPos(pos);
			let territoryIndex = territorypos[0] + territorypos[1] * this.territoryMap.width;
			for (let i = 1; i < this.baseManagers.length; ++i) {
				let base = this.baseManagers[i];
				if ((!ent.getMetadata(PlayerID, "base") || ent.getMetadata(PlayerID, "base") !== base.ID) &&
					base.territoryIndices.indexOf(territoryIndex) === -1)
					continue;
				base.assignEntity(gameState, ent);
				bestbase = base;
				break;
			}
			if (!bestbase)	// entity outside our territory
			{
				if (ent.hasClass("Structure") && !ent.decaying() && ent.resourceDropsiteTypes())
					bestbase = this.createBase(gameState, ent, "anchorless");
				else
					bestbase = m.getBestBase(gameState, ent) || this.baseManagers[0];
				bestbase.assignEntity(gameState, ent);
			}
			// now assign entities garrisoned inside this entity
			if (ent.isGarrisonHolder() && ent.garrisoned().length)
				for (let id of ent.garrisoned())
					bestbase.assignEntity(gameState, gameState.getEntityById(id));
			// and find something useful to do if we already have a base
			if (pos && bestbase.ID !== this.baseManagers[0].ID) {
				bestbase.assignRolelessUnits(gameState, [ent]);
				if (ent.getMetadata(PlayerID, "role") === "worker") {
					bestbase.reassignIdleWorkers(gameState, [ent]);
					bestbase.workerObject.update(gameState, ent);
				}
			}
		}
	};

	/**
	 * determine the main land Index (or water index if none)
	 * as well as the list of allowed (land andf water) regions
	 */
	m.HQ.prototype.regionAnalysis = function (gameState) {
		let accessibility = gameState.ai.accessibility;
		let landIndex;
		let seaIndex;
		let ccEnts = gameState.getOwnStructures().filter(API3.Filters.byClass("CivCentre"));
		for (let cc of ccEnts.values()) {
			let land = accessibility.getAccessValue(cc.position());
			if (land > 1) {
				landIndex = land;
				break;
			}
		}
		if (!landIndex) {
			let civ = gameState.getPlayerCiv();
			for (let ent of gameState.getOwnEntities().values()) {
				if (!ent.position() || !ent.hasClass("Unit") && !ent.trainableEntities(civ))
					continue;
				let land = accessibility.getAccessValue(ent.position());
				if (land > 1) {
					landIndex = land;
					break;
				}
				let sea = accessibility.getAccessValue(ent.position(), true);
				if (!seaIndex && sea > 1)
					seaIndex = sea;
			}
		}
		if (!landIndex && !seaIndex) {
/// DEBUG
			gameState.ai.logger.push("ERROR", "StartingStrategy", "AI does not know how to interpret this map.");
/// DEBUG
			return false;
		}

		let passabilityMap = gameState.getPassabilityMap();
		let totalSize = passabilityMap.width * passabilityMap.width;
		let minLandSize = Math.floor(0.1 * totalSize);
		let minWaterSize = Math.floor(0.2 * totalSize);
		let cellArea = passabilityMap.cellSize * passabilityMap.cellSize;
		for (let i = 0; i < accessibility.regionSize.length; ++i) {
			if (landIndex && i === landIndex)
				this.landRegions[i] = true;
			else if (accessibility.regionType[i] === "land" && cellArea * accessibility.regionSize[i] > 320) {
				if (landIndex) {
					let sea = this.getSeaBetweenIndices(gameState, landIndex, i);
					if (sea && (accessibility.regionSize[i] > minLandSize || accessibility.regionSize[sea] > minWaterSize)) {
						this.navalMap = true;
						this.landRegions[i] = true;
						this.navalRegions[sea] = true;
					}
				} else {
					let traject = accessibility.getTrajectToIndex(seaIndex, i);
					if (traject && traject.length === 2) {
						this.navalMap = true;
						this.landRegions[i] = true;
						this.navalRegions[seaIndex] = true;
					}
				}
			} else if (accessibility.regionType[i] === "water" && accessibility.regionSize[i] > minWaterSize) {
				this.navalMap = true;
				this.navalRegions[i] = true;
			} else if (accessibility.regionType[i] === "water" && cellArea * accessibility.regionSize[i] > 3600)
				this.navalRegions[i] = true;
		}
/// DEBUG
		for (let region in this.landRegions) {
			gameState.ai.logger.push("DEBUG", "StartingStrategy", "Region: " + region + " Size: " + cellArea * gameState.ai.accessibility.regionSize[region]);
		}
		gameState.ai.logger.push("DEBUG", "StartingStrategy", "Naval Map: " + this.navalMap);
		gameState.ai.logger.push("DEBUG", "StartingStrategy", "Land Regions: " + uneval(this.landRegions));
		gameState.ai.logger.push("DEBUG", "StartingStrategy", "Naval Regions: " + uneval(this.navalRegions));
/// DEBUG
		return true;
	};

	/**
	 * load units and buildings from the config files
	 * TODO: change that to something dynamic
	 */
	m.HQ.prototype.structureAnalysis = function (gameState) {
		let civref = gameState.playerData.civ;
		let civ = civref in this.Config.buildings ? civref : 'default';
		this.bAdvanced = [];
		for (let building of this.Config.buildings[civ])
			if (gameState.isTemplateAvailable(gameState.applyCiv(building)))
				this.bAdvanced.push(gameState.applyCiv(building));
	};

	/**
	 * build our first base
	 * if not enough resource, try first to do a dock
	 */
	m.HQ.prototype.buildFirstBase = function (gameState) {
		if (gameState.ai.queues.civilCentre.hasQueuedUnits())
			return;
		let templateName = gameState.applyCiv("structures/{civ}_civil_centre");
		if (gameState.isTemplateDisabled(templateName))
			return;
		let template = gameState.getTemplate(templateName);
		if (!template)
			return;
		let total = gameState.getResources();
		let goal = "civil_centre";
		if (!total.canAfford(new API3.Resources(template.cost()))) {
			let totalExpected = gameState.getResources();
			// Check for treasures around available in some maps at startup
			for (let ent of gameState.getOwnUnits().values()) {
				if (!ent.position())
					continue;
				// If we can get a treasure around, just do it
				if (ent.isIdle())
					m.gatherTreasure(gameState, ent);
				// Then count the resources from the treasures being collected
				let supplyId = ent.getMetadata(PlayerID, "supply");
				if (!supplyId)
					continue;
				let supply = gameState.getEntityById(supplyId);
				if (!supply || supply.resourceSupplyType().generic !== "treasure")
					continue;
				let type = supply.resourceSupplyType().specific;
				if (!(type in totalExpected))
					continue;
				totalExpected[type] += supply.resourceSupplyMax();
				// If we can collect enough resources from these treasures, wait for them
				if (totalExpected.canAfford(new API3.Resources(template.cost())))
					return;
			}

			// not enough resource to build a cc, try with a dock to accumulate resources if none yet
			if (!this.navalManager.docks.filter(API3.Filters.byClass("Dock")).hasEntities()) {
				if (gameState.ai.queues.dock.hasQueuedUnits())
					return;
				templateName = gameState.applyCiv("structures/{civ}_dock");
				if (gameState.isTemplateDisabled(templateName))
					return;
				template = gameState.getTemplate(templateName);
				if (!template || !total.canAfford(new API3.Resources(template.cost())))
					return;
				goal = "dock";
			}
		}
		if (!this.canBuild(gameState, templateName))
			return;

		// We first choose as startingPoint the point where we have the more units
		let startingPoint = [];
		for (let ent of gameState.getOwnUnits().values()) {
			if (!ent.hasClass("Worker") && !(ent.hasClass("Support") && ent.hasClass("Elephant")))
				continue;
			if (ent.hasClass("Cavalry"))
				continue;
			let pos = ent.position();
			if (!pos) {
				let holder = m.getHolder(gameState, ent);
				if (!holder || !holder.position())
					continue;
				pos = holder.position();
			}
			let gamepos = gameState.ai.accessibility.gamePosToMapPos(pos);
			let index = gamepos[0] + gamepos[1] * gameState.ai.accessibility.width;
			let land = gameState.ai.accessibility.landPassMap[index];
			let sea = gameState.ai.accessibility.navalPassMap[index];
			let found = false;
			for (let point of startingPoint) {
				if (land !== point.land || sea !== point.sea)
					continue;
				if (API3.SquareVectorDistance(point.pos, pos) > 2500)
					continue;
				point.weight += 1;
				found = true;
				break;
			}
			if (!found)
				startingPoint.push({"pos": pos, "land": land, "sea": sea, "weight": 1});
		}
		if (!startingPoint.length)
			return;

		let imax = 0;
		for (let i = 1; i < startingPoint.length; ++i)
			if (startingPoint[i].weight > startingPoint[imax].weight)
				imax = i;

		if (goal === "dock") {
			let sea = startingPoint[imax].sea > 1 ? startingPoint[imax].sea : undefined;
			gameState.ai.queues.dock.addPlan(new m.ConstructionPlan(gameState, "Dock", "structures/{civ}_dock", {
				"sea": sea,
				"proximity": startingPoint[imax].pos
			}));
		} else
			gameState.ai.queues.civilCentre.addPlan(new m.ConstructionPlan(gameState, "CivCentre", "structures/{civ}_civil_centre", {
				"base": -1,
				"resource": "wood",
				"proximity": startingPoint[imax].pos
			}));
	};

	/**
	 * set strategy if game without construction:
	 *   - if one of our allies has a cc, affect a small fraction of our army for his defence, the rest will attack
	 *   - otherwise all units will attack
	 */
	m.HQ.prototype.dispatchUnits = function (gameState) {
		let allycc = gameState.getExclusiveAllyEntities().filter(API3.Filters.byClass("CivCentre")).toEntityArray();
		if (allycc.length) {
/// DEBUG
			gameState.ai.logger.push("DEBUG", "StartingStrategy", "Our ally has " + allycc.length + " Civil Centre(s) and has " + gameState.getOwnUnits().length + " units.");
/// DEBUG
			let units = gameState.getOwnUnits();
			let num = Math.max(Math.min(Math.round(0.08 * (1 + this.Config.Personality.cooperative) * units.length), 20), 5);
			let num1 = Math.floor(num / 2);
			let num2 = num1;
			// first pass to affect ranged infantry
			units.filter(API3.Filters.byClassesAnd(["Infantry", "Ranged"])).forEach(ent => {
				if (!num || !num1)
					return;
				if (ent.getMetadata(PlayerID, "allied"))
					return;
				let access = m.getLandAccess(gameState, ent);
				for (let cc of allycc) {
					if (!cc.position() || m.getLandAccess(gameState, cc) !== access)
						continue;
					--num;
					--num1;
					ent.setMetadata(PlayerID, "allied", true);
					let range = 1.5 * cc.footprintRadius();
					ent.moveToRange(cc.position()[0], cc.position()[1], range, range);
					break;
				}
			});
			// second pass to affect melee infantry
			units.filter(API3.Filters.byClassesAnd(["Infantry", "Melee"])).forEach(ent => {
				if (!num || !num2)
					return;
				if (ent.getMetadata(PlayerID, "allied"))
					return;
				let access = m.getLandAccess(gameState, ent);
				for (let cc of allycc) {
					if (!cc.position() || m.getLandAccess(gameState, cc) !== access)
						continue;
					--num;
					--num2;
					ent.setMetadata(PlayerID, "allied", true);
					let range = 1.5 * cc.footprintRadius();
					ent.moveToRange(cc.position()[0], cc.position()[1], range, range);
					break;
				}
			});
			// and now complete the affectation, including all support units
			units.forEach(ent => {
				if (!num && !ent.hasClass("Support"))
					return;
				if (ent.getMetadata(PlayerID, "allied"))
					return;
				let access = m.getLandAccess(gameState, ent);
				for (let cc of allycc) {
					if (!cc.position() || m.getLandAccess(gameState, cc) !== access)
						continue;
					if (!ent.hasClass("Support"))
						--num;
					ent.setMetadata(PlayerID, "allied", true);
					let range = 1.5 * cc.footprintRadius();
					ent.moveToRange(cc.position()[0], cc.position()[1], range, range);
					break;
				}
			});
		}
	};

	/**
	 * configure our first base expansion
	 *   - if on a small island, favor fishing
	 *   - count the available wood resource, and allow rushes only if enough (we should otherwise favor expansion)
	 */
	m.HQ.prototype.configFirstBase = function (gameState) {
		if (this.baseManagers.length < 2)
			return;

		this.firstBaseConfig = true;

		// - count the available wood resource, and react accordingly
		let startingFood = gameState.getResources().food;
		let check = {};
		for (let proxim of ["nearby", "medium", "faraway"]) {
			for (let base of this.baseManagers) {
				for (let supply of base.dropsiteSupplies.food[proxim]) {
					if (check[supply.id])    // avoid double counting as same resource can appear several time
						continue;
					check[supply.id] = true;
					startingFood += supply.ent.resourceSupplyAmount();
				}
			}
		}

		// - count the available wood resource, and allow rushes only if enough (we should otherwise favor expansion)
		let startingWood = gameState.getResources().wood;
		check = {};
		for (let proxim of ["nearby", "medium", "faraway"]) {
			for (let base of this.baseManagers) {
				for (let supply of base.dropsiteSupplies.wood[proxim]) {
					if (check[supply.id])    // avoid double counting as same resource can appear several time
						continue;
					check[supply.id] = true;
					startingWood += supply.ent.resourceSupplyAmount();
				}
			}
		}
/// DEBUG
		gameState.ai.logger.push("INFO", "StartingStrategy", "Initial wood around: " + startingWood + " (cut at 8500 for no rush and 6000 for saveResources)");
/// DEBUG
		if (startingWood < 6000) {
			this.saveResources = true;
		}

		// immediatly build a wood dropsite if possible.
		let template = gameState.applyCiv("structures/{civ}_storehouse");
		if (!gameState.getOwnEntitiesByClass("Storehouse", true).hasEntities() && this.canBuild(gameState, template)) {
			let newDP = this.baseManagers[1].findBestDropsiteLocation(gameState, "wood");
			if (newDP.quality > 40) {
				// if we start with enough workers, put our available resources in this first dropsite
				// same thing if our pop exceed the allowed one, as we will need several houses
				let numWorkers = gameState.getOwnUnits().filter(API3.Filters.byClass("Worker")).length;
				if (numWorkers > 12 && newDP.quality > 60 ||
					gameState.getPopulation() > gameState.getPopulationLimit() + 20) {
					let cost = new API3.Resources(gameState.getTemplate(template).cost());
					gameState.ai.queueManager.setAccounts(gameState, cost, "dropsites");
				}
				gameState.ai.queues.dropsites.addPlan(new m.ConstructionPlan(gameState, "Storehouse", template, {"base": this.baseManagers[1].ID}, newDP.pos));
			}
		}
	};

	return m;

}(ARCH);
