import { describe,it,expect } from 'vitest';
import { metadata, signatureMatches, uploadInput } from './validation';

describe('asset validation',()=>{
  it('rejects empty, oversized, mismatched-extension and active inline types',()=>{
    for(const value of [{filename:'x.png',mimeType:'image/png',byteSize:0},{filename:'x.png',mimeType:'image/png',byteSize:1024**3+1},{filename:'x.exe',mimeType:'image/png',byteSize:4},{filename:'x.svg',mimeType:'image/svg+xml',byteSize:4},{filename:'../x.png',mimeType:'image/png',byteSize:4}])expect(()=>uploadInput(value)).toThrow();
    expect(uploadInput({filename:'photo.png',mimeType:'image/png',byteSize:1024})).toEqual({filename:'photo.png',mimeType:'image/png',byteSize:1024});
    expect(()=>uploadInput({filename:'photo.png',mimeType:'__proto__',byteSize:1024})).toThrow('Unsupported file type');
  });
  it('checks real signatures independently of a claimed content type',()=>{
    const png=new Uint8Array([137,80,78,71,13,10,26,10]);
    expect(signatureMatches('image/png',png)).toBe(true);
    expect(signatureMatches('image/jpeg',png)).toBe(false);
    expect(signatureMatches('application/pdf',new TextEncoder().encode('<html>'))).toBe(false);
    expect(signatureMatches('application/pdf',new TextEncoder().encode('%PDF-1.7'))).toBe(true);
  });
  it('bounds metadata and deduplicates tags without dropping valid text',()=>{
    expect(metadata({title:' Test ',tags:['one',' one ','two']})).toEqual({title:'Test',alt:'',notes:'',tags:['one','two']});
    expect(()=>metadata({title:'',tags:[]})).toThrow();
    expect(()=>metadata({title:'x',tags:[42]})).toThrow();
    expect(()=>metadata({title:'x',notes:'x'.repeat(5001)})).toThrow();
  });
});
