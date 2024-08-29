import { Argv, Context, Schema } from 'koishi'
import 'koishi-plugin-adapter-onebot'
export const name = 'newlife'
export const usage = `
此插件可以让bot快速切换身份  
暂仅支持onebot协议   
`
export interface Config {
  presets:Array<{
  nickName: string,
  avatar: string,
  personalNote: string
  }>
}

export const Config: Schema<Config> = Schema.object({
  presets: Schema.array(Schema.object({
    nickName: Schema.string().default("奏").description("昵称"),
    avatar: Schema.string().description("头像(URL)").default("https://tncache1-f1.v3mh.com/image/2024/08/29/632329be271dcf8e8db6ced5c0a1c3bb.jpg"),
    personalNote: Schema.string().description("个签").default("要创作出令人幸福的歌曲"),
    hello:Schema.string().default("我是%s,你好").description("寒暄")
  })).role('table'),
})

export function apply(ctx: Context,config:Config) {
  ctx.command('newlife <message:text> ','快速更换角色')
  .action((argv,massage) => life(ctx,argv,config,massage))
  .example('newlife 奏')

}

function life(ctx:Context,argv:Argv,config:Config,massage:string){
  if(!argv.session.onebot){
    return "暂仅支持onebot适配器哦"
  }
  let preset 
  for(let object of config.presets){
    if(object.nickName==massage){
      preset=object;
      break;
    }
  }
  try{
  argv.session.onebot.setQqAvatar(preset.avatar);
  argv.session.onebot.setQqProfileAsync(preset.nickName,null,null,null,preset.personalNote)
  let newHello=preset.hello.replace("%s", preset.nickName)
  return newHello;
  }catch(error){
    ctx.logger("newLife").warn("Error:" + error)
  }
}



