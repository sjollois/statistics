import { dateService } from "./date.service";
import { Entity } from "./entities.service";
import { StatsResponse, statsApiService, StatsAccessResponse } from "./stats-api.service";
import { Frequency, ChartDataGroupedByProfile, ChartDataGroupedByProfileAndModule, ChartDataGroupedByProfileWithDate } from "./chart.service";
import { Indicator } from "../indicators/indicator";

export class CacheService {
    
    public async initEntityMonthCacheData(indicators: Array<Indicator>, entity: Entity): Promise<void> {
		// get accounts data from API
		let accountsData: Array<StatsResponse> = await statsApiService.getStats(
			'accounts',
			dateService.getSinceDateISOStringWithoutMs(),
			'month',
			entity.level,
			[entity.id]
		);
		// get accessData from API
		let accessData: Array<StatsAccessResponse> = await statsApiService.getStats(
			'access',
			dateService.getSinceDateISOStringWithoutMs(),
			'month',
			entity.level,
			[entity.id]
		) as Array<StatsAccessResponse>;
		// initialize entity cache data
		entity.cacheData = {
			indicators: [],
			lastUpdate: null
		};
		
		indicators.forEach(indicator => {
			let data: Array<StatsResponse> = [];
			
			if (indicator.api === 'accounts') {
				data = accountsData;
			} else if (indicator.api === 'access' && indicator.name === 'stats.mostUsedApp') {
				data = accessData.filter(x => x.type === 'ACCESS');
			} else if (indicator.api === 'access' && indicator.name === 'stats.mostUsedConnector') {
				data = accessData.filter(x => x.type === 'CONNECTOR');
			}
			
			let total: number = 0;
			if (indicator.name === 'stats.connections') {
				data.forEach(d => total += d[indicator.apiType]);
			} else if (indicator.name === 'stats.activatedAccounts') {
				// activated metric is cumulated so we need to get last value for each profile
				['Student', 'Relative', 'Teacher', 'Personnel', 'Guest'].forEach(profile => {
					const dataFilteredByProfile = data.filter(d => d.profile === profile);
					if (dataFilteredByProfile && dataFilteredByProfile.length > 0) {
						dataFilteredByProfile
							.filter(d => new Date(d.date).getTime() === dateService.getMaxDateFromData(dataFilteredByProfile).getTime())
							.forEach(x => total += x['activated']);
					}
				});
			}
			
			let cacheIndicator = {
				name: indicator.name,
				apiType: indicator.apiType,
				data: data,
				frequency: 'month' as Frequency,
				totalValue: total
			};
			entity.cacheData.lastUpdate = new Date();
			entity.cacheData.indicators.push(cacheIndicator);
		});
	}
    
    public async getDataFromCacheOrApi(indicator: Indicator, entity: Entity): Promise<Array<StatsResponse>> {		
		// get data from entity cache data if present
		let cacheIndicator = entity.cacheData.indicators.find(i => i.name === indicator.name && i.frequency === indicator.frequency);
		if (cacheIndicator && !cacheService.needsRefresh(entity.cacheData.lastUpdate)) {
			return cacheIndicator.data;
		}
		
		// otherwise get data from Stats API
        let response: Array<StatsResponse> = await statsApiService.getStats(
			indicator.api,
            dateService.getSinceDateISOStringWithoutMs(), 
            indicator.frequency,
            entity.level,
			[entity.id]);
		// add data to entity cache
		if (cacheIndicator) {
			entity.cacheData.indicators = entity.cacheData.indicators.filter(i => i.name === cacheIndicator.name && i.frequency === cacheIndicator.frequency);
		}
		entity.cacheData.indicators.push({
			name: indicator.name,
			apiType: indicator.apiType,
			data: response,
			frequency: indicator.frequency
		});
		entity.cacheData.lastUpdate = new Date();
		
		return response;
	}
	
	public async getDataGroupedByProfile(indicator: Indicator, entity: Entity): Promise<ChartDataGroupedByProfile> {
		let data: Array<StatsResponse> = await this.getDataFromCacheOrApi(indicator, entity);
		return statsApiService.groupByKey(data, 'profile', indicator.apiType);
	}
	
	public async getDataGroupedByProfileWithDate(indicator: Indicator, entity: Entity): Promise<ChartDataGroupedByProfileWithDate> {
		let data: Array<StatsResponse> = await this.getDataFromCacheOrApi(indicator, entity);
		return statsApiService.groupByProfileWithDate(data, indicator.apiType);
	}
	
	public async getDataGroupedByProfileAndModule(indicator: Indicator, entity: Entity): Promise<ChartDataGroupedByProfileAndModule> {
		let data = await this.getDataFromCacheOrApi(indicator, entity);
		return statsApiService.groupByKeys(data, 'profile', 'module', indicator.apiType);
	}
    
    public needsRefresh(date: Date): boolean {
        return dateService.moreThanOneHourAgo(date);
    }
}

export const cacheService = new CacheService();