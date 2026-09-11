import { describe,it,expect } from 'vitest';
import { safetyAnswer, scoreEvidence, validateCitations, type EvidenceSignals } from './rag.js';
import { readConfig } from './config.js';
import type { Answer } from '@machine-memory/shared';
const strong: EvidenceSignals = {exactAsset:true,exactEvent:true,priorOccurrences:2,linkedResolution:true,crossAsset:true,authoritativeTechnical:false,authoritativeSafety:false,conflicting:false,onlyDemo:false,intent:'HISTORY',substantiveSupport:4};
describe('pre-synthesis safety boundary', () => {
  it.each(['bypass the relay','disable protection','defeat the interlock','override safety','skip isolation','ignore the trip','run faulted equipment','energized work','protection-setting changes','change protection settings','disable the safety interlock','operate a faulted turbine'])('refuses %s',question => {
    expect(safetyAnswer({assetCode:'WT-07',intent:'GENERAL',question})?.answer.safetyStatus).toBe('REFUSED');
  });
  it('returns insufficient for unsupported settings',() => expect(safetyAnswer({assetCode:'WT-07',intent:'TECHNICAL_GUIDANCE',question:'What torque is required?'})?.answer.summary).toBe('Insufficient verified evidence.'));
  it('passes ordinary history to retrieval',() => expect(safetyAnswer({assetCode:'WT-07',intent:'HISTORY',question:'Has this fault happened before?' })).toBeNull());
});
describe('evidence integrity', () => {
  it('caps synthetic and user-demo only evidence',() => expect(scoreEvidence({...strong,onlyDemo:true})).toBe('MODERATE'));
  it('rejects conflicting support',() => expect(scoreEvidence({...strong,conflicting:true})).toBe('INSUFFICIENT'));
  it('scores strong non-demo support',() => expect(scoreEvidence(strong)).toBe('HIGH'));
  const answer: Answer = {summary:'test',findings:[{title:'History',detail:'A claim',citationIds:['invented']}],evidenceStrength:'MODERATE',uncertainties:[],safetyStatus:'NORMAL'};
  it('rejects invented citations',() => expect(() => validateCitations(answer,[])).toThrow('Unknown citation'));
  it('rejects uncited findings',() => expect(() => validateCitations({...answer,findings:[{title:'x',detail:'x',citationIds:[]}]},[])).toThrow('Uncited'));
});
it('refuses production or public binding without login',() => {
  expect(() => readConfig({NODE_ENV:'production'})).toThrow('Production');
  expect(() => readConfig({HOST:'0.0.0.0'})).toThrow('loopback');
});
