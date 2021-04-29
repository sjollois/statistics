import { ng, template, ui, _, $, idiom as lang } from 'entcore';

import { Indicator } from './indicators/abstractIndicator';
import { Entity, StructuresResponse } from './services/entities.service';
import { entitiesService } from './services/entities.service';
import { cacheService } from './services/cache.service';
import { ConnectionsIndicator } from './indicators/line/connectionsIndicator';
import { UniqueVisitorsIndicator } from './indicators/line/uniqueVisitorsIndicator';
import { ConnectionsPerUniqueVisitorIndicator } from './indicators/line/connectionsPerUniqueVisitorIndicator';
import { MostUsedAppsIndicator } from './indicators/bar/mostUsedAppsIndicator';
import { MostUsedConnectorsIndicator } from './indicators/bar/mostUsedConnectorsIndicator';
import { DevicesIndicator } from './indicators/line/devicesIndicator';
import { ConnectionsDailyPeakIndicator } from './indicators/stackedBar/connectionsDailyPeakIndicator';
import { ConnectionsWeeklyPeakIndicator } from './indicators/stackedBar/connectionsWeeklyPeakIndicator';
import { ActivationAndLoadedIndicator } from './indicators/line/activationAndLoadedIndicator';
import { AppDetailsIndicator } from './indicators/line/appDetailsIndicator';
import { ConnectorDetailsIndicator } from "./indicators/line/connectorDetailsIndicator";
import { AppService } from './services/app.service';
import { ExportType, ExportService } from './services/export.service';
import { UserService } from "./services/user.service";

declare const Chart: any;

type StatsControllerState = {
	structuresTree: Array<StructuresResponse>;
	entities: Array<Entity>;
	currentEntity: Entity;
	currentIndicator: Indicator;
	indicators: Array<Indicator>;
	selectedAppName: string;
	allAppsOrConnectorsI18nKey: string;
	exportType: ExportType;
	chart: typeof Chart;
	ctx: any;
}

interface StatsControllerScope {
	$root: any;
	display: {
		loading: boolean, 
		lightbox: {
			export: {
				topLevelEntity: boolean,
				bottomLevelEntity: boolean
			}
		}
	}
	state: StatsControllerState,
	template: typeof template;
	lang: typeof lang;
	definitions: Array<string>;
	
	openIndicator(indicator: Indicator): Promise<void>;
	indicatorDetail(indicator: Indicator): void;
	openView(container: any, view: any);
	selectEntity(id: string): Promise<void>;
	selectEntityAndOpenIndicator(id: string, indicator: Indicator): Promise<void>;
	openAppDetails(): void;
	displayAppsSelect(): boolean;
	isOnlyOneConnector(indicator: Indicator): boolean;
	isIndicatorSelected(indicator: Indicator): boolean;
	export(): void;
	exportFromLightbox(): void;
	$apply: any;
}

/**
	Wrapper controller
	------------------
	Main controller.
**/
export const statsController = ng.controller('StatsController', ['$scope', '$timeout', 'model',
	async ($scope: StatsControllerScope, $timeout, model) => {

	/////////////////////////////////////////////
	/*               INIT & VIEWS              */
	$scope.template = template;
	$scope.lang = lang;
	
	// home definitions
	$scope.definitions = [
		'uniqueVisitor',
		'connectionsByUniqueVisitor',
		'contents'
	]
	
	template.open('main', 'global');
	template.open('list', 'icons-list');
	
	$scope.state = {
		structuresTree: [],
		entities: [],
		currentEntity: null,
		currentIndicator: null,
		indicators: [],
		selectedAppName: 'stats.mostUsedApps.allApps',
		allAppsOrConnectorsI18nKey: 'stats.mostUsedApps.allApps',
		exportType: null,
		chart: null,
		ctx: null,
	};

	$scope.display = {
		loading: true,
		lightbox: {
			export: {
				topLevelEntity: false,
				bottomLevelEntity: false
			}
		}
	};
	
	// build structures tree for structures select component
	let structures: Array<StructuresResponse> = await entitiesService.getStructures();
	$scope.state.structuresTree = entitiesService.asTree(structures);
	
	$scope.state.entities = [];
	structures.forEach(s => {
		$scope.state.entities.push({
			id: s.id,
			name: s.name,
			level: 'structure',
			children: s.children,
			classes: s.classes
		});
		if (s.classes && s.classes.length > 0) {
			s.classes.forEach(c => {
				$scope.state.entities.push({
					id: c.id,
					name: c.name,
					level: 'class',
					parentStructureId: s.id
				});
			});
		}
	});
	
	$scope.state.currentEntity = $scope.state.entities[0];
	
	const safeScopeApply = (fn?: any) => {
		try {
			const phase = $scope.$root && $scope.$root.$$phase;
			if (phase == '$apply' || phase == '$digest') {
				if (fn && (typeof (fn) === 'function')) {
					fn();
				}
			} else {
				$scope.$apply(fn);
			}
		} catch (e) { }
	};

	// Indicators list
	$scope.state.indicators = [
		ConnectionsIndicator.getInstance(),
		UniqueVisitorsIndicator.getInstance(),
		ConnectionsPerUniqueVisitorIndicator.getInstance(),
		MostUsedAppsIndicator.getInstance(),
		MostUsedConnectorsIndicator.getInstance(),
		DevicesIndicator.getInstance(),
		ConnectionsDailyPeakIndicator.getInstance(),
		ConnectionsWeeklyPeakIndicator.getInstance(),
		ActivationAndLoadedIndicator.getInstance()
	];
	
	/**
	 * Hide/Show MostUsedConnectors Indicator card.
	 * If no data returned for connectors then hide card.
	 */
	const toggleMostUsedConnectorsIndicator = async (entity: Entity): Promise<void> => {
		await MostUsedConnectorsIndicator.getInstance().init(entity);
		const connectorsApiData = await cacheService.getIndicatorData(MostUsedConnectorsIndicator.getInstance(), entity);
		const connectorsIndex = $scope.state.indicators.findIndex(i => i.name === MostUsedConnectorsIndicator.getInstance().name);

		if (connectorsApiData && connectorsApiData.length > 0) {
			// if data and not present, insert it after MostUsedAppsIndicator
			if (connectorsIndex === -1) {
				const mostUsedAppsIndex = $scope.state.indicators.findIndex(i => i.name === MostUsedAppsIndicator.getInstance().name);
				$scope.state.indicators.splice(mostUsedAppsIndex + 1, 0, MostUsedConnectorsIndicator.getInstance());
			}
		} else {
			// if no data and present, remove it
			if (connectorsIndex > -1) {
				$scope.state.indicators.splice(connectorsIndex, 1);
			}
		}
	};
	
	/**** INIT Data ****/
	let initData = async () => {
		// Spinner on
		$scope.display.loading = true;

		await toggleMostUsedConnectorsIndicator($scope.state.currentEntity);

		for (let index = 0; index < $scope.state.indicators.length; index++) {
			const indicator = $scope.state.indicators[index];
			// init indicators data per month for current entity
			// (connectors already initialised before)
			if (indicator.name !== 'stats.mostUsedConnector') {
				await indicator.init($scope.state.currentEntity);
			}
		}
		
		// Spinner off
		setTimeout(() => {
			$scope.display.loading = false;
			safeScopeApply();
		}, 500);
		
		safeScopeApply(); 
	}
	
	initData();

	$scope.openIndicator = async (indicator): Promise<void> => {
		if(!indicator) {
			return;
		}

		$scope.state.currentIndicator = indicator;

		if ($scope.state.currentIndicator.name === 'stats.mostUsedApp') {
			$scope.state.allAppsOrConnectorsI18nKey = 'stats.mostUsedApps.allApps';
			$scope.state.selectedAppName = $scope.state.allAppsOrConnectorsI18nKey;
		} else if ($scope.state.currentIndicator.name === 'stats.mostUsedConnector') {
			// if only one connector then display details indicator
			const indicatorFromCache = $scope.state.currentEntity.cacheData.indicators.find(i => i.name === $scope.state.currentIndicator.name);
			const connectorNames = AppService.getInstance().getAppNames(indicatorFromCache.data);
			
			if (connectorNames.length === 1) {
				$scope.state.selectedAppName = connectorNames[0].key;
				$scope.openAppDetails();
				return;
			} else {
				$scope.state.allAppsOrConnectorsI18nKey = 'stats.mostUsedConnector.allConnectors';
				$scope.state.selectedAppName = $scope.state.allAppsOrConnectorsI18nKey;
			}
		}

		let chartContext = $('#chart').get(0).getContext('2d');
		if ($scope.state.ctx && $scope.state.ctx !== chartContext){
			$scope.state.ctx = chartContext;
		} else {
			$scope.state.ctx = $scope.state.ctx && $scope.state.ctx === chartContext ? $scope.state.ctx : chartContext;
		}
		
		if ($scope.state.chart) {
			$scope.state.chart.destroy();
		}
		
		let indicatorChart = await $scope.state.currentIndicator.getChart($scope.state.ctx, $scope.state.currentEntity);
		$scope.state.chart = indicatorChart;
	}

	$scope.indicatorDetail = function(indicator){
		$scope.openView('list', 'table-list')

		var timeoutFunction = function(count){
			if(count < 10 && $('#chart').length <= 0){
				$timeout(function(){ timeoutFunction(count+1) }, 50*count)
			} else {
				$scope.openIndicator(indicator)
			}
		}

		$timeout(function(){
			timeoutFunction(1)
		}, 50)

	}

	$scope.openAppDetails = async function() {
		if ($scope.state.selectedAppName) {
			AppService.getInstance().setSelectedAppName($scope.state.selectedAppName);

			if ($scope.state.selectedAppName === 'stats.mostUsedApps.allApps') {
				await $scope.openIndicator(MostUsedAppsIndicator.getInstance());
			} else if ($scope.state.selectedAppName === 'stats.mostUsedConnector.allConnectors') {
				await $scope.openIndicator(MostUsedConnectorsIndicator.getInstance());
			} else {
				let detailsIndicator;
				if ($scope.state.currentIndicator.name === 'stats.mostUsedApp' ||
					$scope.state.currentIndicator.name === 'stats.appDetails') {
					detailsIndicator = AppDetailsIndicator.getInstance();
				} else {
					detailsIndicator = ConnectorDetailsIndicator.getInstance();
				}
				await detailsIndicator.init($scope.state.currentEntity);
				await $scope.openIndicator(detailsIndicator);
			}
			safeScopeApply();
		}
	}

	$scope.displayAppsSelect = function(): boolean {
		return $scope.state.currentIndicator &&
			($scope.state.currentIndicator.name === 'stats.mostUsedApp' || 
			$scope.state.currentIndicator.name === 'stats.mostUsedConnector' ||
			$scope.state.currentIndicator.name === 'stats.appDetails' ||
			($scope.state.currentIndicator.name === 'stats.connectorDetails' && $scope.state.currentIndicator.appNames.length > 1));
	}

	$scope.openView = function(container, view){
		if(container === 'lightbox') {
			ui.showLightbox();
		} else {
			ui.hideLightbox();
		}
		$scope.state.currentIndicator = null;
		template.open(container, view);
	}
	
	const initEntityOnChange = async (entityId: string): Promise<void> => {
		$scope.state.currentEntity = $scope.state.entities.find(e => e.id === entityId);
		if (!$scope.state.currentEntity.cacheData 
			|| cacheService.needsRefresh($scope.state.currentEntity.cacheData.lastUpdate)) {
			await initData();
		}
		await toggleMostUsedConnectorsIndicator($scope.state.currentEntity);
	}

	$scope.selectEntity = async (entityId: string): Promise<void> => {
		await initEntityOnChange(entityId);
		safeScopeApply();
	}
	
	$scope.selectEntityAndOpenIndicator = async (entityId: string, indicator: Indicator): Promise<void> => {
		await initEntityOnChange(entityId);
		if (indicator.name === 'stats.mostUsedConnector' && 
			!$scope.state.indicators.find(i => i.name === 'stats.mostUsedConnector')) {
			await $scope.openIndicator(ConnectionsIndicator.getInstance());
		} else {
			await $scope.openIndicator(indicator);
		}
		safeScopeApply();
	}

	$scope.isOnlyOneConnector = (indicator: Indicator): boolean => {
		if (indicator && indicator.appNames) {
			return indicator.appNames.length === 1;
		}
		return false;
	}

	$scope.isIndicatorSelected = (indicator: Indicator): boolean => {
		if (!$scope.state.currentIndicator) {
			return false;
		} 

		if ($scope.state.currentIndicator.name === 'stats.appDetails') {
			return indicator.name === 'stats.mostUsedApp';
		} else if ($scope.state.currentIndicator.name === 'stats.connectorDetails') {
			return indicator.name === 'stats.mostUsedConnector';
		}
		
		return $scope.state.currentIndicator === indicator;
	}

	/**
	 * Called when user clicks on export link.
	 */
	$scope.export = () => {
		if (!$scope.state.currentEntity) {
			return;
		}

		// SHOW LIGHTBOX for ADMC/ADML
		if (UserService.getInstance().isAdml(model.me.functions, $scope.state.currentEntity) || 
			UserService.getInstance().isAdmc(model.me.functions)) {
			// if toplevel structure => aggregated or details by structures data
			if (entitiesService.isTopLevelStructure($scope.state.currentEntity)) {
				$scope.state.exportType = 'topLevel.aggregated';
				$scope.display.lightbox.export.topLevelEntity = true;
			} else {
				// else => structure data or structure classes data
				$scope.state.exportType = 'bottomLevel.structure';
				$scope.display.lightbox.export.bottomLevelEntity = true;
			}
		} 
		// DIRECT EXPORT for non ADMC/ADML
		else {
			// pas de lightbox pour les non ADML/ADMC, on exporte la structure courante ou les classes de l'utilisateur s'il est sur une classe
			let exportUrl: string = '';
			if ($scope.state.currentEntity.level === 'structure') {
				exportUrl = ExportService.getInstance().getExportUrl($scope.state.currentEntity, $scope.state.currentIndicator, 'bottomLevel.structure');
			} else {
				// if current = classe, export all user classes
				exportUrl = ExportService.getInstance().getExportUrl($scope.state.currentEntity, $scope.state.currentIndicator, 'user.classes', model.me.classes);
			}
			window.open(exportUrl, '_blank');
		}
	}

	/**
	 * Called when user confirms export in lighbox. (For ADMC/ADML)
	 */
	$scope.exportFromLightbox = () => {
		$scope.display.lightbox.export.topLevelEntity = false;
		$scope.display.lightbox.export.bottomLevelEntity = false;
		window.open(ExportService.getInstance().getExportUrl($scope.state.currentEntity, $scope.state.currentIndicator, $scope.state.exportType, model.me.classes), '_blank');
	}
}]);
