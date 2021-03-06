/**
 * Manage the trade
 */

ARCH.TradeManager = function (Config) {
	this.Config = Config;
	this.tradeRoute = undefined;
	this.potentialTradeRoute = undefined;
	this.routeProspection = false;
	this.targetNumTraders = 5;
	this.warnedAllies = {};
	this.marketPosTries = 0;

	this.rate = {}; // Resource rates: [buy][sell]
	this.lastCheckedTurn = {};
	for (let res of Resources.GetCodes()) {
		this.rate[res] = {};
		this.lastCheckedTurn[res] = {};
		for (let res2 of Resources.GetCodes()) {
			this.rate[res][res2] = 0;
			this.lastCheckedTurn[res][res2] = 0;
		}
	}
};

ARCH.TradeManager.prototype.init = function (gameState) {
	this.traders = gameState.getOwnUnits().filter(API3.Filters.byMetadata(PlayerID, "role", "trader"));
	this.traders.registerUpdates();
	this.minimalGain = gameState.ai.HQ.navalMap ? 3 : 5;
	this.marketPosTries = 0;

	this.logger = gameState.ai.logger;
};

ARCH.TradeManager.prototype.hasTradeRoute = function () {
	return this.tradeRoute !== undefined;
};

ARCH.TradeManager.prototype.assignTrader = function (ent) {
	ent.setMetadata(PlayerID, "role", "trader");
	this.traders.updateEnt(ent);
};

ARCH.TradeManager.prototype.trainMoreTraders = function (gameState, queues) {
	if (!this.hasTradeRoute() || queues.trader.hasQueuedUnits())
		return;

	let numTraders = this.traders.length;
	let numSeaTraders = this.traders.filter(API3.Filters.byClass("Ship")).length;
	let numLandTraders = numTraders - numSeaTraders;
	// add traders already in training
	gameState.getOwnTrainingFacilities().forEach(function (ent) {
		for (let item of ent.trainingQueue()) {
			if (!item.metadata || !item.metadata.role || item.metadata.role !== "trader")
				continue;
			numTraders += item.count;
			if (item.metadata.sea !== undefined)
				numSeaTraders += item.count;
			else
				numLandTraders += item.count;
		}
	});
	if (numTraders >= Math.min(this.Config.Economy.maxTraderCount, this.targetNumTraders))
		return;

	let template;
	let metadata = {"role": "trader"};
	if (this.tradeRoute.sea) {
		// if we have some merchand ships affected to transport, try first to reaffect them
		// May-be, there were produced at an early stage when no other ship were available
		// and the naval manager will train now more appropriate ships.
		let already = false;
		let shipToSwitch;
		gameState.ai.HQ.navalManager.seaTransportShips[this.tradeRoute.sea].forEach(function (ship) {
			if (already || !ship.hasClass("Trader"))
				return;
			if (ship.getMetadata(PlayerID, "role") === "switchToTrader") {
				already = true;
				return;
			}
			shipToSwitch = ship;
		});
		if (already)
			return;
		if (shipToSwitch) {
			if (shipToSwitch.getMetadata(PlayerID, "transporter") === undefined)
				shipToSwitch.setMetadata(PlayerID, "role", "trader");
			else
				shipToSwitch.setMetadata(PlayerID, "role", "switchToTrader");
			return;
		}

		template = gameState.applyCiv("units/{civ}_ship_merchant");
		metadata.sea = this.tradeRoute.sea;
	} else {
		template = gameState.applyCiv("units/{civ}_support_trader");
		if (!this.tradeRoute.source.hasClass("NavalMarket"))
			metadata.base = this.tradeRoute.source.getMetadata(PlayerID, "base");
		else
			metadata.base = this.tradeRoute.target.getMetadata(PlayerID, "base");
	}

	if (!gameState.getTemplate(template)) {
/// DEBUG
		gameState.ai.logger.push("ERROR", "TradeManager", "Couldn't fetch the unit template. Trying to train " + template + " for civ " +
			gameState.getPlayerCiv() + " but no template found.");
/// DEBUG
		return;
	}
	queues.trader.addPlan(new ARCH.TrainingPlan(gameState, template, metadata, 1, 1));
};

ARCH.TradeManager.prototype.updateTrader = function (gameState, ent) {
	if (ent.hasClass("Ship") &&
		!ent.unitAIState().startsWith("INDIVIDUAL.GATHER") &&
		ARCH.gatherTreasure(gameState, ent, true))
		return;

	if (!this.hasTradeRoute() || !ent.isIdle() || !ent.position())
		return;
	if (ent.getMetadata(PlayerID, "transport") !== undefined)
		return;

	// TODO if the trader is idle and has workOrders, restore them to avoid losing the current gain

///
	Engine.ProfileStart("Trade Manager");
///
	let access = ent.hasClass("Ship") ? ARCH.getSeaAccess(gameState, ent) : ARCH.getLandAccess(gameState, ent);
	let route = this.checkRoutes(gameState, access);
	if (!route) {
		// TODO try to garrison land trader inside merchant ship when only sea routes available
/// DEBUG
		gameState.ai.logger.push("DEBUG", "TradeManager", "There aren't any available routes for " + ent.genericName() + " " + ent.id());
/// DEBUG
///
		Engine.ProfileStop();
///
		return;
	}

	let nearerSource = true;
	if (API3.SquareVectorDistance(route.target.position(), ent.position()) < API3.SquareVectorDistance(route.source.position(), ent.position()))
		nearerSource = false;

	if (!ent.hasClass("Ship") && route.land !== access) {
		if (nearerSource)
			gameState.ai.HQ.navalManager.requireTransport(gameState, ent, access, route.land, route.source.position());
		else
			gameState.ai.HQ.navalManager.requireTransport(gameState, ent, access, route.land, route.target.position());
///
		Engine.ProfileStop();
///
		return;
	}

	if (nearerSource)
		ent.tradeRoute(route.target, route.source);
	else
		ent.tradeRoute(route.source, route.target);
	ent.setMetadata(PlayerID, "route", this.routeEntToId(route));
///
	Engine.ProfileStop();
///
};

ARCH.TradeManager.prototype.setTradingGoods = function (gameState) {
	let tradingGoods = {};
	for (let res of Resources.GetCodes())
		tradingGoods[res] = 0;
	// first, try to anticipate future needs
	let stocks = gameState.ai.HQ.getTotalResourceLevel(gameState);
	let mostNeeded = gameState.ai.HQ.pickMostNeededResources(gameState);
	let wantedRates = gameState.ai.HQ.GetWantedGatherRates(gameState);
	let remaining = 100;
	let targetNum = 0;
	for (let res in stocks) {
		if (res === "food")
			continue;
		let wantedRate = wantedRates[res];
		if (stocks[res] < 200) {
			tradingGoods[res] = wantedRate > 0 ? 20 : 10;
			targetNum += Math.min(5, 3 + Math.ceil(wantedRate / 30));
		} else if (stocks[res] < 500) {
			tradingGoods[res] = wantedRate > 0 ? 15 : 10;
			targetNum += 2;
		} else if (stocks[res] < 1000) {
			tradingGoods[res] = 10;
			targetNum += 1;
		}
		remaining -= tradingGoods[res];
	}
	this.targetNumTraders += targetNum;


	// then add what is needed now
	let mainNeed = Math.floor(remaining * 70 / 100);
	let nextNeed = remaining - mainNeed;

	tradingGoods[mostNeeded[0].type] += mainNeed;
	if (mostNeeded[1] && mostNeeded[1].wanted > 0)
		tradingGoods[mostNeeded[1].type] += nextNeed;
	else
		tradingGoods[mostNeeded[0].type] += nextNeed;
	Engine.PostCommand(PlayerID, {"type": "set-trading-goods", "tradingGoods": tradingGoods});

/// DEBUG
	gameState.ai.logger.push("DEBUG", "TradeManager", "Trading goods were set to " + uneval(tradingGoods));
/// DEBUG
};

/**
 * Try to barter unneeded resources for needed resources.
 * only once per turn because the info is not updated within a turn
 */
ARCH.TradeManager.prototype.performBarter = function (gameState) {
	let barterers = gameState.getOwnEntitiesByClass("BarterMarket", true).filter(API3.Filters.isBuilt()).toEntityArray();
	if (barterers.length === 0)
		return false;

	// Available resources after account substraction
	let available = gameState.ai.queueManager.getAvailableResources(gameState);
	let needs = gameState.ai.queueManager.currentNeeds(gameState);

	let rates = gameState.ai.HQ.GetCurrentGatherRates(gameState);

	let barterPrices = gameState.getBarterPrices();
	// calculates conversion rates
	let getBarterRate = (prices, buy, sell) => Math.round(100 * prices.sell[sell] / prices.buy[buy]);

	let popRatio = gameState.getPopulation() / gameState.getPopulationMax();

	// loop through each missing resource checking if we could barter and help to finish a queue quickly.
	for (let buy of Resources.GetCodes()) {
		if (available[buy] > 1000) {
			continue;
		}

		for (let sell of Resources.GetCodes()) {
			if (sell === buy)
				continue;
			if (available[sell] < 1000) {
				continue;
			}

			let barterRateMin = 10000 / Math.max(available[sell], 1);

			if (gameState.ai.playedTurn < 10 + this.lastCheckedTurn[sell][buy]) {
				barterRateMin = Math.max(barterRateMin, 1e4 / this.rate[sell][buy]);
			}

			let barterRate = getBarterRate(barterPrices, buy, sell);

			if (barterRate > barterRateMin || (barterRateMin > 33 && available[buy] < 500)) {
				let amount = Math.max(available[sell] - 1000, 100);

				barterers[0].barter(buy, sell, amount);

				this.lastCheckedTurn[buy][sell] = gameState.ai.playedTurn;
				this.rate[buy][sell] = barterRate;

				available[sell] -= amount;

/// DEBUG
				gameState.ai.logger.push("DEBUG", "TradeManager", "Necessity bartering: sold " + sell + " for " + buy +
					" >> need sell " + needs[sell] + " need buy " + needs[buy] +
					" rate buy " + rates[buy] + " available sell " + available[sell] +
					" available buy " + available[buy] + " barterRate " + barterRate +
					" amount " + amount);
/// DEBUG
			}
		}
	}
};

ARCH.TradeManager.prototype.checkEvents = function (gameState, events) {
	// check if one market from a traderoute is renamed, change the route accordingly
	for (let evt of events.EntityRenamed) {
		let ent = gameState.getEntityById(evt.newentity);
		if (!ent || !ent.hasClass("Market"))
			continue;
		for (let trader of this.traders.values()) {
			let route = trader.getMetadata(PlayerID, "route");
			if (!route)
				continue;
			if (route.source === evt.entity)
				route.source = evt.newentity;
			else if (route.target === evt.entity)
				route.target = evt.newentity;
			else
				continue;
			trader.setMetadata(PlayerID, "route", route);
		}
	}

	// if one market (or market-foundation) is destroyed, we should look for a better route
	for (let evt of events.Destroy) {
		if (!evt.entityObj)
			continue;
		let ent = evt.entityObj;
		if (!ent || !ent.hasClass("Market") || !gameState.isPlayerAlly(ent.owner()))
			continue;
		this.activateProspection(gameState);
		return true;
	}

	// same thing if one market is built
	for (let evt of events.Create) {
		let ent = gameState.getEntityById(evt.entity);
		if (!ent || ent.foundationProgress() !== undefined || !ent.hasClass("Market") ||
			!gameState.isPlayerAlly(ent.owner()))
			continue;
		this.activateProspection(gameState);
		return true;
	}


	// and same thing for captured markets
	for (let evt of events.OwnershipChanged) {
		if (!gameState.isPlayerAlly(evt.from) && !gameState.isPlayerAlly(evt.to))
			continue;
		let ent = gameState.getEntityById(evt.entity);
		if (!ent || ent.foundationProgress() !== undefined || !ent.hasClass("Market"))
			continue;
		this.activateProspection(gameState);
		return true;
	}

	// or if diplomacy changed
	if (events.DiplomacyChanged.length) {
		this.activateProspection(gameState);
		return true;
	}

	return false;
};

ARCH.TradeManager.prototype.activateProspection = function (gameState) {
	this.routeProspection = true;
	gameState.ai.HQ.buildManager.setBuildable(gameState.applyCiv("structures/{civ}_market"));
	gameState.ai.HQ.buildManager.setBuildable(gameState.applyCiv("structures/{civ}_dock"));
};

/**
 * fills the best trade route in this.tradeRoute and the best potential route in this.potentialTradeRoute
 * If an index is given, it returns the best route with this index or the best land route if index is a land index
 */
ARCH.TradeManager.prototype.checkRoutes = function (gameState, accessIndex) {
	let market1 = gameState.updatingCollection("OwnMarkets", API3.Filters.byClass("Market"), gameState.getOwnStructures());
	let market2 = gameState.updatingCollection("diplo-ExclusiveAllyMarkets", API3.Filters.byClass("Market"), gameState.getExclusiveAllyEntities());
	if (market1.length + market2.length < 2)  // We have to wait  ... markets will be built soon
	{
		this.tradeRoute = undefined;
		this.potentialTradeRoute = undefined;
		return false;
	}

	let onlyOurs = !market2.hasEntities();
	if (onlyOurs)
		market2 = market1;
	let candidate = {"gain": 0};
	let potential = {"gain": 0};
	let bestIndex = {"gain": 0};
	let bestLand = {"gain": 0};

	let mapSize = gameState.sharedScript.mapSize;
	let traderTemplatesGains = gameState.getTraderTemplatesGains();

	for (let m1 of market1.values()) {
		if (!m1.position())
			continue;
		let access1 = ARCH.getLandAccess(gameState, m1);
		let sea1 = m1.hasClass("NavalMarket") ? ARCH.getSeaAccess(gameState, m1) : undefined;
		for (let m2 of market2.values()) {
			if (onlyOurs && m1.id() >= m2.id())
				continue;
			if (!m2.position())
				continue;
			let access2 = ARCH.getLandAccess(gameState, m2);
			let sea2 = m2.hasClass("NavalMarket") ? ARCH.getSeaAccess(gameState, m2) : undefined;
			let land = access1 === access2 ? access1 : undefined;
			let sea = sea1 && sea1 === sea2 ? sea1 : undefined;
			if (!land && !sea)
				continue;
			if (land && ARCH.isLineInsideEnemyTerritory(gameState, m1.position(), m2.position()))
				continue;
			let gainMultiplier;
			if (land && traderTemplatesGains.landGainMultiplier)
				gainMultiplier = traderTemplatesGains.landGainMultiplier;
			else if (sea && traderTemplatesGains.navalGainMultiplier)
				gainMultiplier = traderTemplatesGains.navalGainMultiplier;
			else
				continue;
			let gain = Math.round(gainMultiplier * TradeGain(API3.SquareVectorDistance(m1.position(), m2.position()), mapSize));
			if (gain < this.minimalGain)
				continue;
			if (m1.foundationProgress() === undefined && m2.foundationProgress() === undefined) {
				if (accessIndex) {
					if (gameState.ai.accessibility.regionType[accessIndex] === "water" && sea === accessIndex) {
						if (gain < bestIndex.gain)
							continue;
						bestIndex = {"source": m1, "target": m2, "gain": gain, "land": land, "sea": sea};
					} else if (gameState.ai.accessibility.regionType[accessIndex] === "land" && land === accessIndex) {
						if (gain < bestIndex.gain)
							continue;
						bestIndex = {"source": m1, "target": m2, "gain": gain, "land": land, "sea": sea};
					} else if (gameState.ai.accessibility.regionType[accessIndex] === "land") {
						if (gain < bestLand.gain)
							continue;
						bestLand = {"source": m1, "target": m2, "gain": gain, "land": land, "sea": sea};
					}
				}
				if (gain < candidate.gain)
					continue;
				candidate = {"source": m1, "target": m2, "gain": gain, "land": land, "sea": sea};
			}
			if (gain < potential.gain)
				continue;
			potential = {"source": m1, "target": m2, "gain": gain, "land": land, "sea": sea};
		}
	}

	if (potential.gain < 1)
		this.potentialTradeRoute = undefined;
	else
		this.potentialTradeRoute = potential;

	if (candidate.gain < 1) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "TradeManager", "No better trade route possible");
/// DEBUG
		this.tradeRoute = undefined;
		return false;
	}
/// DEBUG
	if (this.tradeRoute) {
		gameState.ai.logger.push("DEBUG", "TradeManager", "One better trade route set with gain " + candidate.gain + " instead of " + this.tradeRoute.gain);
	} else {
		gameState.ai.logger.push("DEBUG", "TradeManager", "One trade route set with gain " + candidate.gain);
	}
/// DEBUG
	this.tradeRoute = candidate;

	if (this.Config.chat) {
		let owner = this.tradeRoute.source.owner();
		if (owner === PlayerID)
			owner = this.tradeRoute.target.owner();
		if (owner !== PlayerID && !this.warnedAllies[owner]) {	// Warn an ally that we have a trade route with him
			ARCH.chatNewTradeRoute(gameState, owner);
			this.warnedAllies[owner] = true;
		}
	}

	if (accessIndex) {
		if (bestIndex.gain > 0)
			return bestIndex;
		else if (gameState.ai.accessibility.regionType[accessIndex] === "land" && bestLand.gain > 0)
			return bestLand;
		return false;
	}
	return true;
};

/** Called when a market was built or destroyed, and checks if trader orders should be changed */
ARCH.TradeManager.prototype.checkTrader = function (gameState, ent) {
	let presentRoute = ent.getMetadata(PlayerID, "route");
	if (!presentRoute)
		return;

	if (!ent.position()) {
		// This trader is garrisoned, we will decide later (when ungarrisoning) what to do
		ent.setMetadata(PlayerID, "route", undefined);
		return;
	}

	let access = ent.hasClass("Ship") ? ARCH.getSeaAccess(gameState, ent) : ARCH.getLandAccess(gameState, ent);
	let possibleRoute = this.checkRoutes(gameState, access);
	// Warning:  presentRoute is from metadata, so contains entity ids
	if (!possibleRoute ||
		possibleRoute.source.id() !== presentRoute.source && possibleRoute.source.id() !== presentRoute.target ||
		possibleRoute.target.id() !== presentRoute.source && possibleRoute.target.id() !== presentRoute.target) {
		// Trader will be assigned in updateTrader
		ent.setMetadata(PlayerID, "route", undefined);
		if (!possibleRoute && !ent.hasClass("Ship")) {
			let closestBase = ARCH.getBestBase(gameState, ent, true);
			if (closestBase.accessIndex === access) {
				let closestBasePos = closestBase.anchor.position();
				ent.moveToRange(closestBasePos[0], closestBasePos[1], 0, 15);
				return;
			}
		}
		ent.stopMoving();
	}
};

ARCH.TradeManager.prototype.prospectForNewMarket = function (gameState, queues) {
	if (queues.economicBuilding.hasQueuedUnitsWithClass("Market") || queues.dock.hasQueuedUnitsWithClass("Market"))
		return;
	if (!gameState.ai.HQ.canBuild(gameState, "structures/{civ}_market"))
		return;
	if (!gameState.updatingCollection("OwnMarkets", API3.Filters.byClass("Market"), gameState.getOwnStructures()).hasEntities() &&
		!gameState.updatingCollection("diplo-ExclusiveAllyMarkets", API3.Filters.byClass("Market"), gameState.getExclusiveAllyEntities()).hasEntities())
		return;
	let template = gameState.getTemplate(gameState.applyCiv("structures/{civ}_market"));
	if (!template)
		return;
	this.checkRoutes(gameState);
	let marketPos = gameState.ai.HQ.findMarketLocation(gameState, template);
	if (!marketPos || marketPos[3] === 0)   // marketPos[3] is the expected gain
	{	// no position found
		if (gameState.getOwnEntitiesByClass("BarterMarket", true).hasEntities())
			gameState.ai.HQ.buildManager.setUnbuildable(gameState, gameState.applyCiv("structures/{civ}_market"));
		else
			this.routeProspection = false;
		return;
	}
	this.routeProspection = false;
	if (!this.isNewMarketWorth(marketPos[3]))
		return;	// position found, but not enough gain compared to our present route
/// DEBUG
	if (this.potentialTradeRoute) {
		gameState.ai.logger.push("DEBUG", "TradeManager", "Turn " + gameState.ai.playedTurn + "we could have a new route with gain " +
			marketPos[3] + " instead of the present " + this.potentialTradeRoute.gain);
	} else {
		gameState.ai.logger.push("DEBUG", "Turn " + gameState.ai.playedTurn + "we could have a first route with gain " +
			marketPos[3]);
	}
/// DEBUG
	let plan = new ARCH.ConstructionPlan(gameState, "BarterMarket", "structures/{civ}_market");
	queues.market.addPlan(plan);
};

ARCH.TradeManager.prototype.isNewMarketWorth = function (expectedGain) {
/// DEBUG
	this.logger.push("DEBUG", "TradeManager", "MarketPosTries: " + this.marketPosTries + " expectedGain: " + expectedGain);
/// DEBUG
	if (expectedGain < this.minimalGain) {
		return false;
	} else if (!this.potentialTradeRoute || (this.potentialTradeRoute && (expectedGain > 2 * this.potentialTradeRoute.gain ||
		expectedGain > Math.max(4, (this.potentialTradeRoute.gain + 20) * Math.max(0, 1 - this.marketPosTries / 20))))) {
		this.marketPosTries = 0;
		return true;
	}
	this.marketPosTries++;
	return false;
};

ARCH.TradeManager.prototype.update = function (gameState, events, queues) {
	if (gameState.ai.HQ.canBarter)
		this.performBarter(gameState);

	if (this.checkEvents(gameState, events))  // true if one market was built or destroyed
	{
		this.traders.forEach(ent => {
			this.checkTrader(gameState, ent);
		});
		this.checkRoutes(gameState);
	}

	if (this.tradeRoute) {
		this.traders.forEach(ent => {
			this.updateTrader(gameState, ent);
		});

		this.trainMoreTraders(gameState, queues);
		if (this.traders.length >= 2)
			gameState.ai.HQ.researchManager.researchTradeBonus(gameState, queues);
		this.setTradingGoods(gameState);
	}

	if (this.routeProspection)
		this.prospectForNewMarket(gameState, queues);
};

ARCH.TradeManager.prototype.routeEntToId = function (route) {
	if (!route)
		return undefined;

	let ret = {};
	for (let key in route) {
		if (key === "source" || key === "target") {
			if (!route[key])
				return undefined;
			ret[key] = route[key].id();
		} else
			ret[key] = route[key];
	}
	return ret;
};

ARCH.TradeManager.prototype.routeIdToEnt = function (gameState, route) {
	if (!route)
		return undefined;

	let ret = {};
	for (let key in route) {
		if (key === "source" || key === "target") {
			ret[key] = gameState.getEntityById(route[key]);
			if (!ret[key])
				return undefined;
		} else
			ret[key] = route[key];
	}
	return ret;
};

///
ARCH.TradeManager.prototype.Serialize = function () {
	return {
		"tradeRoute": this.routeEntToId(this.tradeRoute),
		"potentialTradeRoute": this.routeEntToId(this.potentialTradeRoute),
		"routeProspection": this.routeProspection,
		"targetNumTraders": this.targetNumTraders,
		"warnedAllies": this.warnedAllies
	};
};

ARCH.TradeManager.prototype.Deserialize = function (gameState, data) {
	for (let key in data) {
		if (key === "tradeRoute" || key === "potentialTradeRoute")
			this[key] = this.routeIdToEnt(gameState, data[key]);
		else
			this[key] = data[key];
	}
};