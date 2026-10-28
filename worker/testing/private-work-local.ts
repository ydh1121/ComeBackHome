// Isolated CI entry only. Never referenced by canonical Wrangler configs.
import { handleProductRequest } from "../modules/gateway";
import type { WorkerEnv } from "../runtime-types";
import { digest } from "../modules/auth/crypto";
export function createDriveFixture() {
  const files = new Map<
    string,
    {
      name: string;
      mimeType: string;
      parents: string[];
      bytes: Uint8Array;
      total: number;
      appProperties?: Record<string,string>;
    }
  >();
  let sequence = 0;
  let moves = 0, loseMoveResponse = false, metadataVersion = 1;
  const expired = new Set<string>();
  let shared = false,
    corrupt = false,
    revision = "synthetic-revision";
  const fakeDrive: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    if (u.origin === "https://oauth2.googleapis.com")
      return Response.json({ access_token: "synthetic-access-only", refresh_token: "synthetic-refresh" });
    if (u.origin === "https://openidconnect.googleapis.com")
      return Response.json({ sub: "synthetic-google-subject" });
    if (u.origin !== "https://www.googleapis.com")
      throw Error("EXTERNAL_PROVIDER_DISABLED");
    if (u.pathname.endsWith("/generateIds"))
      return Response.json({ ids: ["synthetic-file-" + ++sequence] });
    const permission = { id: "synthetic-owner", type: "user", role: "owner" };
    const id = u.pathname.split("/")[4];
    if (u.pathname.endsWith("/permissions"))
      return Response.json({
        permissions: shared
          ? [permission, { id: "public", type: "anyone", role: "reader" }]
          : [permission],
      });
    if (id === "synthetic-folder")
      return Response.json({
        id,
        mimeType: "application/vnd.google-apps.folder",
        permissions: shared
          ? [permission, { id: "public", type: "anyone", role: "reader" }]
          : [permission],
      });
    if (u.pathname.startsWith("/upload/")) {
      if (init?.method === "POST") {
        if(u.searchParams.get('uploadType')==='multipart'){
          const parts=String(init.body).split('\r\n\r\n');
          const metadata=JSON.parse(parts[1].split('\r\n--')[0]);
          if(metadata.mimeType!=='application/vnd.google-apps.document')return new Response(null,{status:400});
          const bytes=new TextEncoder().encode(parts[2].split('\r\n--')[0]),id='synthetic-chat-'+ ++sequence;
          files.set(id,{...metadata,bytes,total:bytes.length});metadataVersion++;
          return Response.json({id});
        }
        const body = JSON.parse(String(init.body));
        expired.delete(body.id);
        files.set(body.id, {
          ...body,
          bytes: new Uint8Array(0),
          total: Number(
            new Headers(init.headers).get("X-Upload-Content-Length"),
          ),
        });
        return new Response(null, {
          status: 200,
          headers: {
            Location:
              "https://www.googleapis.com/upload/drive/v3/files?upload_id=" +
              body.id,
          },
        });
      }
      const file = files.get(u.searchParams.get("upload_id")!);
      if (!file || expired.has(u.searchParams.get("upload_id")!))
        return new Response(null, { status: 404 });
      const range = new Headers(init?.headers).get("Content-Range")!;
      if (!range.startsWith("bytes */")) {
        const start = Number(range.match(/^bytes (\d+)-/)?.[1]);
        if (start !== file.bytes.length)
          return new Response(null, { status: 409 });
        const chunk = new Uint8Array(init?.body as ArrayBuffer),
          next = new Uint8Array(file.bytes.length + chunk.length);
        next.set(file.bytes);
        next.set(chunk, file.bytes.length);
        file.bytes = next;
      }
      if (file.bytes.length === file.total)
        return Response.json({ id: u.searchParams.get("upload_id") });
      return new Response(null, {
        status: 308,
        headers: file.bytes.length
          ? { Range: "bytes=0-" + (file.bytes.length - 1) }
          : {},
      });
    }
    if(u.pathname==='/drive/v3/files'&&init?.method!=='POST'){
      const exchange=u.searchParams.get('q')?.match(/key='cbhChatExchange' and value='([^']+)'/)?.[1];
      return Response.json({files:[...files.entries()].filter(([,file])=>file.appProperties?.cbhChatExchange===exchange).map(([id])=>({id}))});
    }
    if (u.pathname === "/drive/v3/files" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if(files.has(body.id))return new Response(null,{status:409});
      files.set(body.id,{...body,bytes:new Uint8Array(0),total:0});
      return Response.json({id:body.id});
    }
    const file = files.get(id);
    if (!file || file.bytes.length !== file.total)
      return new Response(null, { status: 404 });
    const etag='"'+revision+':'+file.parents.join(',')+':'+metadataVersion+'"';
    if(init?.method === "PATCH") {
      const expected=new Headers(init.headers).get('If-Match');
      if(expected && expected!==etag)return new Response(null,{status:412});
      const from=u.searchParams.get('removeParents'),to=u.searchParams.get('addParents');
      if(!from || !to || file.parents.length!==1 || file.parents[0]!==from || !files.has(to))return new Response(null,{status:409});
      file.parents=[to];moves++;metadataVersion++;
      if(loseMoveResponse){loseMoveResponse=false;throw Error('synthetic lost move response');}
      return Response.json({id,parents:file.parents});
    }
    if (u.searchParams.get("alt") === "media")
      return new Response(
        corrupt ? new Uint8Array(file.bytes.length) : file.bytes,
        {
          headers: { "Content-Type": file.mimeType },
        },
      );
    if(u.pathname.endsWith('/export'))return new Response(file.bytes,{headers:{'Content-Type':'text/plain; charset=utf-8'}});
    if(u.pathname.startsWith('/drive/v2/'))return Response.json({id,etag,headRevisionId:revision,version:String(metadataVersion),parents:file.parents.map(id=>({id})),labels:{trashed:false}});
    return Response.json({
      id,
      name: file.name,
      mimeType: file.mimeType,
      parents: file.parents,
      size: String(file.bytes.length),
      sha256Checksum: await digest(file.bytes.buffer as ArrayBuffer),
      headRevisionId: revision,
      version: String(metadataVersion),
      permissions:shared?[permission,{id:'public',type:'anyone',role:'reader'}]:[permission],
      ...(file.appProperties?{appProperties:file.appProperties}:{}),
    },{headers:{ETag:etag}});
  };
  return {
    fetcher: fakeDrive,
    expire(id: string) {
      expired.add(id);
    },
    share(value: boolean) {
      shared = value;
    },
    corruptDownload(value: boolean) {
      corrupt = value;
    },
    changeRevision(value: string) {
      revision = value;
      metadataVersion++;
    },
    changeMetadataVersion() { metadataVersion++; },
    loseNextMoveResponse() { loseMoveResponse=true; },
    moves() { return moves; },
    parents(id:string) { return [...(files.get(id)?.parents??[])]; },
    changeParents(id:string, parents:string[]) { const file=files.get(id);if(file)file.parents=parents; },
    ids() {
      return [...files.keys()];
    },
    answerChat(id:string,answer:string,result:unknown){
      const file=files.get(id);
      if(!file?.appProperties?.cbhChatExchange||answer.length>40000)return false;
      const initial=JSON.parse(new TextDecoder().decode(file.bytes));
      file.bytes=new TextEncoder().encode(JSON.stringify({version:'cbh-chat-response/v1',requestId:file.appProperties.cbhChatExchange,sourceFingerprint:initial.sourceFingerprint,status:'ready',answer,result}));
      file.total=file.bytes.length;metadataVersion++;return true;
    },
  };
}
const driveFixture=createDriveFixture(),fakeDrive=driveFixture.fetcher;
export default {
  async fetch(request: Request, env: WorkerEnv) {
    const url=new URL(request.url);
    // Only the isolated local test entry exposes synthetic provider control.
    // This file is excluded from canonical configs and production bundles.
    if(url.hostname==='127.0.0.1'&&url.pathname==='/__test/chat-response'&&request.method==='POST'){
      const body=await request.json() as {id:string;answer:string;result:unknown};
      return Response.json({ok:driveFixture.answerChat(body.id,body.answer,body.result)});
    }
    if (new URL(request.url).pathname.startsWith("/api/"))
      return handleProductRequest(request, env, null, fakeDrive);
    return env.ASSETS!.fetch(request);
  },
};
