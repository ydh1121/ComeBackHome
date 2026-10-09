import type {
  ImageTextLayout,
  ImageTextProbeRegion,
  ImageTextProbeResult,
  ParsedImport,
  ParsedScheduleCandidate,
  ParsedScheduleReviewCandidate,
} from '../../application/contracts/providers';
import {
  analyzeScheduleCellVisualEvidence,
  pixelSupportedColumnBounds,
  type ScheduleCellVisualEvidence,
  type SchedulePixelBounds,
  type ScheduleTableStructureDetection,
} from './ScheduleTableStructureDetector';
import { classifyScheduleShiftLabel } from './ScheduleImportSemantics';
import { parseScheduleImageClock } from './StructuredTableImageScheduleRecognizer';

/**
 * A single workplace's Monday-Sunday roster only. Physical cell allocation
 * precedes date OCR: no missing date glyph can destroy the 7x3 grid.
 * This module never commits to D1 and never treats color as proof of OFF.
 */
export type WeeklyField = 'start' | 'end' | 'break';
export interface WeeklyCell {
  id: string;
  rowIndex: number;
  dayIndex: number;
  field: WeeklyField;
  bounds: SchedulePixelBounds;
  visual: ScheduleCellVisualEvidence;
}
export interface WeeklyRow {
  index: number;
  bounds: SchedulePixelBounds;
  nameBounds: SchedulePixelBounds;
  cells: WeeklyCell[];
}
export interface WeeklyDay {
  index: number;
  bounds: SchedulePixelBounds;
  fields: Record<WeeklyField, SchedulePixelBounds>;
}
export interface WeeklyPhysicalMatrix {
  kind: 'WEEKLY_7D_3COL';
  geometrySource: 'PIXEL' | 'DETECTOR';
  headerSource: 'OBSERVED_LABELS' | 'GEOMETRY_REVIEW';
  headerBands: SchedulePixelBounds[];
  days: WeeklyDay[];
  rows: WeeklyRow[];
  /** Never determined from an OCR-generated date. */
  physicalCellCount: number;
}
export interface WeeklyDate {
  dayIndex: number;
  date: string | null;
  observed: boolean;
  reviewRequired: boolean;
}
export interface WeeklyDateResolution {
  dates: WeeklyDate[];
  yearMonthObserved: boolean;
  observedDayAnchors: number;
  uniqueWeek: boolean;
  acceptedForAutomaticSave: boolean;
}

const FIELDS: WeeklyField[] = ['start', 'end', 'break'];
const DAY_COUNT = 7;
const SUBCOLS = 3;
const EXPECTED_BANDS = 1 + DAY_COUNT * SUBCOLS;

function median(values: number[]): number {
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
}

function strictBands(detection: ScheduleTableStructureDetection):
  {bands: SchedulePixelBounds[]; source: 'PIXEL' | 'DETECTOR'} | null {
  const pixel = pixelSupportedColumnBounds(detection);
  const fallback = detection.structure.columnBands.map(x=>x.bounds);
  const candidates = [
    { bands:pixel, source:'PIXEL' as const },
    { bands:fallback, source:'DETECTOR' as const },
  ];
  for(const candidate of candidates){
    const sorted=[...candidate.bands].sort((a,b)=>a.x-b.x);
    // A thin trailing margin can appear as a 23rd band when the table's
    // actual right border AND raster edge are both detected. Remove ONLY
    // a uniquely small terminal outside band; never discard any day cell.
    if(sorted.length===EXPECTED_BANDS+1){
      const clockMedian=median(sorted.slice(1,-1).map(x=>x.width));
      const last=sorted[sorted.length-1];
      const isPhysicalMargin=last.width<clockMedian*.48 &&
        Math.abs(last.x+last.width-detection.raster.width)<=3 &&
        sorted[0].width>clockMedian*1.5;
      if(isPhysicalMargin)sorted.pop();
    }
    if(sorted.length!==EXPECTED_BANDS)continue;
    const widths=sorted.slice(1).map(x=>x.width);
    const typical=median(widths);
    if(typical<13)continue;
    if(widths.some(width=>width<typical*.5||width>typical*1.7))continue;
    // Reject false glyph columns and gaps; do not interpolate a missing band.
    if(sorted.some((v,i)=>i>0&&
      Math.abs(v.x-(sorted[i-1].x+sorted[i-1].width))>Math.max(4,typical*.18)))continue;
    if(sorted[0].width<typical*.6)continue;
    return {...candidate,bands:sorted};
  }
  return null;
}

function headerCountFromLabels(
  bands: SchedulePixelBounds[],
  rows: SchedulePixelBounds[],
  layout: ImageTextLayout,
): number | null {
  const frequency = new Map<number,Set<string>>();
  for(const token of layout.tokens){
    const kind=classifyScheduleShiftLabel(token.text);
    if(!kind)continue;
    const cx=token.x+token.width/2,cy=token.y+token.height/2;
    const row=rows.findIndex(r=>cy>=r.y&&cy<r.y+r.height);
    const col=bands.findIndex(b=>cx>=b.x&&cx<b.x+b.width);
    if(row<0||col<1)continue;
    const day=Math.floor((col-1)/SUBCOLS);
    const key=frequency.get(row)??new Set<string>();
    key.add(day+':'+kind);
    frequency.set(row,key);
  }
  // More than two independent days with actual OCR field labels.
  const header=[...frequency.entries()]
    .filter(([,k])=>new Set([...k].map(x=>x.split(':')[0])).size>=3)
    .sort((a,b)=>b[1].size-a[1].size)[0];
  return header ? header[0]+1 : null;
}

export function buildWeekly3ColumnPhysicalMatrix(
  detection: ScheduleTableStructureDetection,
  layout: ImageTextLayout,
): WeeklyPhysicalMatrix | null {
  const selected=strictBands(detection);
  if(!selected)return null;
  const rows=[...detection.structure.rowBands]
    .map(b=>b.bounds).sort((a,b)=>a.y-b.y);
  if(rows.length<3)return null;
  const observedHeaderCount=headerCountFromLabels(selected.bands,rows,layout);
  // If field labels are unreadable the first two pixel rows are candidate
  // headers, NOT proof. This forces downstream human review.
  const headerCount=observedHeaderCount??2;
  if(headerCount>=rows.length||headerCount<1)return null;
  const body=rows.slice(headerCount);
  if(body.length>100)return null;
  const cols=selected.bands;
  const days: WeeklyDay[]=Array.from({length:DAY_COUNT},(_,index)=>{
    const fields=Object.fromEntries(FIELDS.map((field,fi)=>
      [field,cols[1+index*SUBCOLS+fi]]
    )) as Record<WeeklyField,SchedulePixelBounds>;
    const start=fields.start.x,end=fields.break.x+fields.break.width;
    return {index,bounds:{x:start,y:0,width:end-start,height:detection.raster.height},fields};
  });
  const matrixRows: WeeklyRow[]=body.map((bounds,index)=>{
    const nameBounds={x:cols[0].x,y:bounds.y,width:cols[0].width,height:bounds.height};
    const cells=days.flatMap(day=>FIELDS.map(field=>{
      const c=day.fields[field];
      const region={x:c.x,y:bounds.y,width:c.width,height:bounds.height};
      return {
        id:'weekly::'+index+'::'+day.index+'::'+field,
        rowIndex:index,dayIndex:day.index,field,
        bounds:region,visual:analyzeScheduleCellVisualEvidence(detection.raster,region),
      };
    }));
    return {index,bounds,nameBounds,cells};
  });
  return {
    kind:'WEEKLY_7D_3COL',geometrySource:selected.source,
    headerSource:observedHeaderCount!=null?'OBSERVED_LABELS':'GEOMETRY_REVIEW',
    headerBands:rows.slice(0,headerCount),days,rows:matrixRows,
    physicalCellCount:matrixRows.length*DAY_COUNT*SUBCOLS,
  };
}

function dayLabel(value: string): number | null {
  const text=String(value??'').normalize('NFKC').replace(/\s+/g,'');
  const match=/^(?:0?([1-9]|[12][0-9]|3[01]))(?:일|日)?$/.exec(text);
  return match?Number(match[1]):null;
}
function format(date: Date): string {
  return String(date.getUTCFullYear())+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+
    '-'+String(date.getUTCDate()).padStart(2,'0');
}
function utc(y:number,m:number,d:number):Date {
  const date=new Date(Date.UTC(y,m-1,d));
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)
    throw Error('Invalid calendar anchor');
  return date;
}

export function resolveWeekly3ColumnDates(
  matrix: WeeklyPhysicalMatrix,
  header: ImageTextLayout,
  probes: ImageTextProbeResult[] = [],
): WeeklyDateResolution {
  const unresolved=()=>({
    dates:matrix.days.map(day=>({
      dayIndex:day.index,date:null,observed:false,reviewRequired:true,
    })),yearMonthObserved:false,observedDayAnchors:0,
    uniqueWeek:false,acceptedForAutomaticSave:false,
  });
  const firstHeaderY=matrix.headerBands[0]?.y??0;
  const topTokens=header.tokens.filter(token=>
    token.y+token.height/2<firstHeaderY);
  // OCR often returns ["년","월","2026","10"] in recognition order.
  // Reassemble only physically adjacent, top-of-page title glyphs by x.
  // The characters and year/month must still be genuinely OCR-observed.
  const orderedTitle=[...topTokens].sort((a,b)=>a.x-b.x)
    .map(x=>x.text.normalize('NFKC')).join('');
  const allText=header.tokens.map(x=>x.text).join(' ');
  const expression=/(20\d{2})\s*년?\s*(1[0-2]|0?[1-9])\s*월/;
  // When the broad Tesseract header drops a glyph, the already-loaded
  // Korean Paddle can read a *separate physical title crop* on the same
  // image. A disagreement is review-only; no year/month can be inferred
  // from current date, timetable, source filename, or generated truth.
  const texts=[
    orderedTitle,allText.normalize('NFKC'),
    ...probes.filter(p=>p.id==='weekly::title::observed')
      .map(p=>p.text.normalize('NFKC')),
  ];
  const observedTitles=texts.map(text=>expression.exec(text)).filter(
    (x):x is RegExpExecArray=>x!=null,
  );
  const result=unresolved();
  const uniqueTitles=new Map(observedTitles.map(match=>[
    match[1]+'-'+String(Number(match[2])).padStart(2,'0'),
    [Number(match[1]),Number(match[2])],
  ]));
  if(uniqueTitles.size!==1)return result;
  result.yearMonthObserved=true;
  const [year,month]=[...uniqueTitles.values()][0];
  const candidates=new Map<number,Set<number>>();
  const dedicated=new Map<number,Set<number>>();
  const readDay=(item:{text:string;x:number;y:number;width:number;height:number})=>{
    const day=dayLabel(item.text);
    if(day==null)return null;
    const cx=item.x+item.width/2,cy=item.y+item.height/2;
    if(!matrix.headerBands.some(r=>cy>=r.y&&cy<r.y+r.height))
      return null;
    const group=matrix.days.find(d=>cx>=d.bounds.x&&cx<d.bounds.x+d.bounds.width);
    return group ? {index:group.index,day} : null;
  };
  // The dedicated date-cell OCR has exact physical ownership of its group.
  // Global full-table Tesseract may put stray day-looking text in that same
  // header. Such unscoped noise cannot veto a valid dedicated crop. Wrong
  // or contradictory dedicated crops still fail the unique-week check.
  for(const probe of probes.filter(p=>p.purpose==='date'&&p.confidence>=.75)){
    for(const token of probe.tokens){
      const parsed=readDay(token);
      if(!parsed)continue;
      const set=dedicated.get(parsed.index)??new Set<number>();
      set.add(parsed.day);dedicated.set(parsed.index,set);
    }
  }
  // Use broad OCR only for physical date groups without dedicated evidence.
  for(const token of header.tokens){
    const parsed=readDay(token);
    if(!parsed||dedicated.has(parsed.index))continue;
    const set=candidates.get(parsed.index)??new Set<number>();
    set.add(parsed.day);candidates.set(parsed.index,set);
  }
  for(const [index,days] of dedicated)candidates.set(index,days);
  const unambiguous=[...candidates.entries()]
    .filter(([,days])=>days.size===1)
    .map(([index,days])=>({index,day:[...days][0]}));
  result.observedDayAnchors=unambiguous.length;
  // At least 2 independent actual day glyphs before calendar interpolation.
  if(unambiguous.length<2)return result;
  const validWeeks=new Set<string>();
  for(const anchor of unambiguous){
    for(const monthShift of [-1,0,1]){
      const anchorMonth=new Date(Date.UTC(year,month-1+monthShift,1));
      const y=anchorMonth.getUTCFullYear(),m=anchorMonth.getUTCMonth()+1;
      let date:Date;
      try{date=utc(y,m,anchor.day);}catch{continue;}
      const monday=new Date(date.getTime()-anchor.index*86400000);
      if(monday.getUTCDay()!==1)continue;
      const consistent=unambiguous.every(other=>{
        const observed=new Date(monday.getTime()+other.index*86400000);
        return observed.getUTCDate()===other.day;
      });
      if(consistent)validWeeks.add(format(monday));
    }
  }
  if(validWeeks.size!==1)return result;
  const start=Date.parse([...validWeeks][0]+'T00:00:00Z');
  const dates=matrix.days.map(day=>{
    const d=new Date(start+day.index*86400000);
    return {dayIndex:day.index,date:format(d),
      observed:candidates.get(day.index)?.has(d.getUTCDate())??false,
      reviewRequired:!candidates.get(day.index)?.has(d.getUTCDate()),
    };
  });
  return {
    dates,yearMonthObserved:true,observedDayAnchors:unambiguous.length,
    uniqueWeek:true,
    // Even 7 OCR day labels do not override unverified person and OFF states.
    acceptedForAutomaticSave:false,
  };
}

export function weekly3ColumnProbeRegions(matrix:WeeklyPhysicalMatrix):ImageTextProbeRegion[] {
  const headerY=matrix.headerBands[0].y;
   const nameColumn=matrix.rows[0].nameBounds;
  const titleRegion:ImageTextProbeRegion={
    id:'weekly::title::observed',purpose:'context',
    x:nameColumn.x,y:0,
    width:Math.max(1,Math.min(nameColumn.width*2,
      matrix.days[0].bounds.x+matrix.days[0].bounds.width-nameColumn.x)),
    height:Math.max(1,headerY),
  };
  const dateRegions: ImageTextProbeRegion[]=matrix.days.map(day=>({
    id:'date::grid-cell::weekly::'+day.index,purpose:'date',
    x:day.bounds.x,y:headerY,
    width:day.bounds.width,height:matrix.headerBands[0].height,
  }));
  const nameRegions:ImageTextProbeRegion[]=matrix.rows.map(row=>({
    id:'weekly-person::'+row.index,purpose:'person',...row.nameBounds,
  }));
  const cellRegions:ImageTextProbeRegion[]=matrix.rows.flatMap(row=>
    row.cells.filter(cell=>cell.visual.occupancy!=='EMPTY')
      .map(cell=>({id:cell.id,purpose:'cell' as const,...cell.bounds})));
  return [titleRegion,...dateRegions,...nameRegions,...cellRegions];
}

function parseBreakMinutes(value:string):number|null {
  const text=String(value??'').normalize('NFKC').trim();
  if(!/^\d{1,2}(?:\.(?:0|5))?$/.test(text))return null;
  const [whole,half]=text.split('.');
  const minutes=Number(whole)*60+(half==='5'?30:0);
  return minutes>=0&&minutes<=12*60?minutes:null;
}

export interface Weekly3ColumnInterpretation {
  parsed:ParsedImport|null;
  blockedReason:string|null;
  reviewCount:number;
  offReviewCount:number;
  unreadableCount:number;
  breakReviewCount:number;
  breakEvidence:Array<{rowIndex:number;dayIndex:number;minutes:number|null;verifiedByUser:false}>;
  consecutiveBlankSpans:Array<{rowIndex:number;fromDay:number;throughDay:number}>;
  dateResolution:WeeklyDateResolution;
}
export function interpretWeekly3Column(
  matrix:WeeklyPhysicalMatrix,
  dates:WeeklyDateResolution,
  regional:ImageTextProbeResult[],
  knownPersonNames:string[],
):Weekly3ColumnInterpretation {
  const byId=new Map(regional.map(r=>[r.id,r]));
  const known=new Set(knownPersonNames.map(x=>x.normalize('NFKC').replace(/\s+/g,'')));
  const personNames=matrix.rows.map(row=>{
    const raw=String(byId.get('weekly-person::'+row.index)?.text??'')
      .normalize('NFKC').replace(/\s+/g,'');
    // Preserve every visible employee row. DB identity is always subject
    // to explicit mapping; never silently discard unknown OCR person names.
    return /^[가-힣]{2,5}$/.test(raw)?raw:'인식불가 직원 '+(row.index+1);
  });
  const blocked=matrix.days.some(day=>!dates.dates[day.index]?.date);
  let reviewCount=0,offReviewCount=0,unreadableCount=0,breakReviewCount=0;
  const review:ParsedScheduleReviewCandidate[]=[];
  const schedule:ParsedScheduleCandidate[]=[];
  const breakEvidence:Array<{rowIndex:number;dayIndex:number;minutes:number|null;verifiedByUser:false}>=[];
  const consecutiveBlankSpans:Array<{rowIndex:number;fromDay:number;throughDay:number}>=[];
  // Repeated fully empty trios are only *candidate* OFF spans; no automatic
  // OFF classification may originate from gray/yellow/white cell backgrounds.
  for(const row of matrix.rows){
    let start=-1;
    for(let index=0;index<=matrix.days.length;index++){
      const blank=index<matrix.days.length&&FIELDS.every(field=>{
        const cell=row.cells.find(x=>x.dayIndex===index&&x.field===field);
        return cell?.visual.occupancy==='EMPTY';
      });
      if(blank&&start<0)start=index;
      if(!blank&&start>=0){
        if(index-start>=2)consecutiveBlankSpans.push({
          rowIndex:row.index,fromDay:start,throughDay:index-1,
        });
        start=-1;
      }
    }
  }
  for(const row of matrix.rows)for(const day of matrix.days){
    const sourceName=personNames[row.index];
    const date=dates.dates[day.index]?.date;
    if(!sourceName||!date)continue;
    const fields=Object.fromEntries(FIELDS.map(field=>[
      field,byId.get('weekly::'+row.index+'::'+day.index+'::'+field),
    ])) as Record<WeeklyField,ImageTextProbeResult|undefined>;
    const pixels=Object.fromEntries(FIELDS.map(field=>[
      field,row.cells.find(c=>c.dayIndex===day.index&&c.field===field)?.visual.occupancy,
    ])) as Record<WeeklyField,ScheduleCellVisualEvidence['occupancy']|undefined>;
    const start=parseScheduleImageClock(fields.start?.text??'');
    const end=parseScheduleImageClock(fields.end?.text??'');
    const breakMinutes=parseBreakMinutes(fields.break?.text??'');
    const threeEmpty=FIELDS.every(f=>pixels[f]==='EMPTY'&&
      !String(fields[f]?.text??'').trim());
    // Color-only blank detection never produces a committed OFF row.
    if(threeEmpty){offReviewCount++;review.push({
      sourcePersonName:sourceName,date,start:null,end:null,sourceRow:row.index+1,
      confidence:.1,recognitionState:'OFF_CANDIDATE',enabled:true,
    });reviewCount++;continue;}
    const valid=start!=null&&end!=null;
    const breakHasContent=pixels.break!=='EMPTY'||!!fields.break?.text.trim();
    // A correctly recognized break does NOT make start/end incomplete.
    // Preserve break evidence for explicit review; schedule storage only
    // accepts start/end and must never subtract unverified break minutes.
    if(breakHasContent){
      breakReviewCount++;
      breakEvidence.push({rowIndex:row.index,dayIndex:day.index,
        minutes:breakMinutes,verifiedByUser:false});
    }
    if(valid&&(!breakHasContent||breakMinutes!=null)){
      schedule.push({sourcePersonName:sourceName,date,start,end,
        sourceRow:row.index+1,
        confidence:Math.min(fields.start?.confidence??0,fields.end?.confidence??0)});
    }else{
      if(!valid)unreadableCount++;
      reviewCount++;
      review.push({sourcePersonName:sourceName,date,start,end,
        sourceRow:row.index+1,confidence:.2,
        recognitionState:valid?'INCOMPLETE':'UNREADABLE',enabled:true});
    }
  }
  const detectedPeople=personNames
    .filter((x,i,all)=>all.indexOf(x)===i)
    .map(name=>({sourceName:name,confidence:known.has(name)?0.9:0.2}));
  // Unmatched names remain in review, not fabricated DB people.
  const blockedReason=blocked?'WEEKLY_DATE_REVIEW_REQUIRED':null;
  const parsed=blockedReason?null:{
    detectedPeople,scheduleCandidates:schedule,reviewCandidates:review,
    structure:{
      sheet:'weekly 7 day x start/end/break physical matrix',
      headerRow:0,
      personColumn:'physical leftmost name + current DB exact prior',
      dateColumn:'observed OCR plus review-required calendar continuity',
      shiftColumn:'start/end/break; rest never silently subtracted; OFF never auto confirmed',
      needsReview:true,
    },
    confidence:Math.min(.5,matrix.headerSource==='OBSERVED_LABELS'?.5:.2),
  };
  return {
    parsed,blockedReason,reviewCount,offReviewCount,unreadableCount,
    breakReviewCount,breakEvidence,consecutiveBlankSpans,dateResolution:dates,
  };
}
