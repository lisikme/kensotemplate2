document.addEventListener('DOMContentLoaded', function() {
    // Конфигурация
    const config = {
        adminsJsonUrl: 'https://lisikme.github.io/Nixware-allowed/admins.json',
        hwidJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/hwid4.json',
        tempJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/temps.json',
        discordJsonUrl: 'https://raw.githubusercontent.com/lisikme/Nixware-allowed/main/discords.json',
        discordApiBase: 'https://discord-api.ketame.ru/api/discord/user/'
    };
    
    // Функция для добавления параметра обхода кеша
    function addCacheBuster(url) {
        const timestamp = new Date().getTime();
        return url + (url.includes('?') ? '&' : '?') + 't=' + timestamp;
    }
    
    async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
        try {
            const cacheBustedUrl = addCacheBuster(url);
            const response = await fetch(cacheBustedUrl, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            if (retries > 0) {
                console.log(`Повторная попытка загрузки (${4-retries}/${3}): ${url}`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchWithRetry(url, options, retries - 1, delay * 2);
            }
            throw error;
        }
    }
    
    function getUserRole(discordId, adminList) {
        if (discordId === '470573716711931905') {
            return 'creator'; 
        }
        if (discordId === '1393856315067203635') {
            return 'bot'; 
        }
        return adminList.includes(discordId) ? 'admin' : 'player';
    }
    
    async function fetchJsonData(url) {
        try {
            return await fetchWithRetry(url);
        } catch (error) {
            console.error(`Ошибка загрузки данных из ${url}:`, error);
            return null;
        }
    }
    
    class AvatarQueue {
        constructor(maxConcurrent = 3) {
            this.maxConcurrent = maxConcurrent;
            this.current = 0;
            this.queue = [];
        }
        
        add(task) {
            return new Promise((resolve, reject) => {
                this.queue.push({ task, resolve, reject });
                this.run();
            });
        }
        
        async run() {
            if (this.current >= this.maxConcurrent || this.queue.length === 0) return;
            this.current++;
            const { task, resolve, reject } = this.queue.shift();
            try {
                const result = await task();
                resolve(result);
            } catch (error) {
                reject(error);
            } finally {
                this.current--;
                this.run();
            }
        }
    }
    
    const avatarQueue = new AvatarQueue(3);
    
    async function loadDiscordAvatar(discordId, elementId, username) {
        if (!discordId) return;
        return avatarQueue.add(async () => {
            try {
                const cacheBustedUrl = addCacheBuster(`${config.discordApiBase}${discordId}`);
                const userData = await fetchWithRetry(cacheBustedUrl);
                if (userData.avatar) {
                    const avatarUrl = `https://cdn.discordapp.com/avatars/${discordId}/${userData.avatar}.png?size=128`;
                    const avatarElement = document.getElementById(elementId);
                    if (avatarElement) {
                        const img = new Image();
                        img.onload = function() {
                            avatarElement.src = avatarUrl;
                            avatarElement.style.opacity = '1';
                        };
                        img.onerror = function() {
                            throw new Error('Ошибка загрузки изображения');
                        };
                        img.src = avatarUrl;
                    }
                    return {
                        discordId: discordId,
                        username: userData.username || username,
                        global_name: userData.global_name || username
                    };
                } else {
                    throw new Error('Аватар не найден');
                }
            } catch (error) {
                console.warn(`Не удалось загрузить аватар для ${discordId}:`, error.message);
                const avatarElement = document.getElementById(elementId);
                if (avatarElement) {
                    avatarElement.setAttribute('data-fallback', 'true');
                    const letterElement = avatarElement.nextElementSibling;
                    if (letterElement && letterElement.classList.contains('avatar_letter')) {
                        letterElement.textContent = username.charAt(0).toUpperCase();
                        letterElement.style.display = 'flex';
                    }
                }
                return {
                    discordId: discordId,
                    username: username,
                    global_name: username
                };
            }
        });
    }
    
    // Функция для преобразования даты в timestamp
    function parseDateToTimestamp(dateString) {
        try {
            // Пробуем разные форматы дат
            if (typeof dateString === 'number') {
                return dateString;
            }
            
            if (dateString.includes('T')) {
                // ISO формат: "2026-02-21T08:10:37.000000"
                return Math.floor(new Date(dateString).getTime() / 1000);
            } else {
                // Другие форматы, пробуем распарсить
                return Math.floor(new Date(dateString).getTime() / 1000);
            }
        } catch (e) {
            console.warn(`Не удалось распарсить дату: ${dateString}`, e);
            return 0;
        }
    }
    
    async function loadUsersData() {
        try {
            const [adminsData, hwidData, tempData, discordData] = await Promise.allSettled([
                fetchJsonData(config.adminsJsonUrl),
                fetchJsonData(config.hwidJsonUrl),
                fetchJsonData(config.tempJsonUrl),
                fetchJsonData(config.discordJsonUrl)
            ]);
            
            // Обработка результатов
            const admins = adminsData.status === 'fulfilled' ? adminsData.value : { Admins: [] };
            const hwid = hwidData.status === 'fulfilled' ? hwidData.value : { "users:": [] };
            const temp = tempData.status === 'fulfilled' ? tempData.value : {};
            const discord = discordData.status === 'fulfilled' ? discordData.value : { hwids: [] };
            
            const adminDiscordIds = admins.Admins || [];
            
            // Функция для поиска Discord ID по HWID
            function getDiscordIdByHwid(hwid, discordData) {
                if (discordData.hwids && Array.isArray(discordData.hwids)) {
                    for (const entry of discordData.hwids) {
                        if (entry.HWID === hwid) {
                            return `${entry.DISCORD}`;
                        }
                    }
                }
                return null;
            }
            
            const usersList = [];
            // Исправляем: используем поле "users:" вместо "users"
            const activeUsers = hwid["users:"] || hwid.users || [];
            
            activeUsers.forEach((username, index) => {
                const userhwid = username;
                const discordId = getDiscordIdByHwid(username, discord);
                const endTime = temp[username] || 0;
                
                usersList.push({
                    id: index + 1,
                    sid: discordId,
                    hwid: userhwid,
                    name: username,
                    flags: '999',
                    immunity: 0,
                    group_id: 'Активная подписка',
                    end: parseDateToTimestamp(endTime),
                    server_id: 0,
                    is_active: true
                });
            });
            
            const allUsers = [...usersList];
            allUsers.sort((a, b) => {
                const aRole = getUserRole(a.sid, adminDiscordIds);
                const bRole = getUserRole(b.sid, adminDiscordIds);
                if (aRole === 'creator') return -1;
                if (bRole === 'creator') return 1;
                if (aRole === 'bot') return -1;
                if (bRole === 'bot') return 1;
                if (aRole === 'admin' && bRole !== 'admin') return -1;
                if (bRole === 'admin' && aRole !== 'admin') return 1;
                return 0;
            });
            
            displayUsers(allUsers, adminDiscordIds);
        } catch (error) {
            console.error('Ошибка загрузки данных пользователей:', error);
            document.getElementById('adminListTitle').textContent = 'Ошибка загрузки данных';
        }
    }
    
    function displayUsers(users, adminDiscordIds) {
        const adminListTitle = document.getElementById('adminListTitle');
        const adminListBlocks = document.getElementById('adminListBlocks');
        adminListTitle.textContent = `Subscribers: ${users.length}`;
        adminListBlocks.innerHTML = '';
        
        const avatarPromises = [];
        const userDiscordData = {}; // Для хранения данных Discord пользователей
        
        users.forEach(user => {
            const userRole = getUserRole(user.sid, adminDiscordIds);
            
            const userCard = document.createElement('div');
            userCard.className = 'admin_card';
            userCard.id = `block-${userRole}`;
            
            let endText = 'Не указано';
            if (user.end === 0) {
                endText = 'Навсегда';
            } else if (user.end > 0 && user.end * 1000 > Date.now()) {
                const endDate = new Date(user.end * 1000);
                endText = `До ${endDate.toLocaleDateString('ru-RU')}`;
            } else if (user.end > 0 && user.end * 1000 <= Date.now()) {
                endText = 'Истек';
            }
            
            userCard.innerHTML = `
                <div id="admins_card">
                    <div class="adminlist_info">
                        <div class="avatar_block">
                            <div class="avatar_letter">${user.name.charAt(0).toUpperCase()}</div>
                            <img class="admins_avatar" id="user-${user.sid}-avatar" src="" alt="" 
                                data-username="${user.name}"
                                onerror="this.setAttribute('data-fallback', 'true');">
                            <div class="adminlist_button steam_button" data-tippy-content="Роль" data-tippy-placement="bottom" id="tag-${userRole}">
                                ${
                                    userRole === 'creator' ? 'Создатель' : (
                                        userRole === 'admin' ? 'Партнёр' : (
                                            userRole === 'bot' ? 'Служба' : 
                                            'Игрок'))}
                            </div>
                        </div>
                        <div class="adminlist_buttons">
                            <div id="admins_info">
                                <span class="admin_nickname">${user.name}</span>
                                <div class="admin_group">
                                    <span class="admin_group_text">${user.group_id}</span>
                                </div>
                                <div class="admin_term">
                                    <span class="admin_term_text">${endText}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="link_block">
                        ${user.sid ? 
                            `<a href="https://discord.com/users/${user.sid}" target="_blank" id="link_prof" class="discord-link" data-discord-id="${user.sid}" data-original-name="${user.name}">
                                <svg viewBox="0 0 24 24">
                                    <path d="M14.82 4.26a10.14 10.14 0 0 0-.53 1.1 14.66 14.66 0 0 0-4.58 0 10.14 10.14 0 0 0-.53-1.1 16 16 0 0 0-4.13 1.3 17.33 17.33 0 0 0-3 11.59 16.6 16.6 0 0 0 5.07 2.59A12.89 12.89 0 0 0 8.23 18a9.65 9.65 0 0 1-1.71-.83 3.39 3.39 0 0 0 .42-.33 11.66 11.66 0 0 0 10.12 0c.14.09.28.19.42.33a10.14 10.14 0 0 1-1.71.83 12.89 12.89 0 0 0 1.08 1.78 16.44 16.44 0 0 0 5.06-2.59 17.22 17.22 0 0 0-3-11.59 16.09 16.09 0 0 0-4.09-1.35zM8.68 14.81a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.93 1.93 0 0 1 1.8 2 1.93 1.93 0 0 1-1.8 2zm6.64 0a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.92 1.92 0 0 1 1.8 2 1.92 1.92 0 0 1-1.8 2z"/>
                                </svg>
                                <span class="discord-username">${user.name}</span>
                            </a>` : 
                            `<a target="_blank" id="link_prof" class="discord-link" data-discord-id="${user.sid}" data-original-name="${user.name}">
                                <p id="no-link">Discord не привязан</p>
                            </a>`
                        }
                    </div>
                </div>
            `;
            
            adminListBlocks.appendChild(userCard);
            
            if (user.sid) {
                const avatarPromise = loadDiscordAvatar(
                    user.sid, 
                    `user-${user.sid}-avatar`,
                    user.name
                ).then(discordData => {
                    if (discordData) {
                        userDiscordData[user.sid] = discordData;
                        // Обновляем никнейм в ссылке на Discord
                        const discordLink = userCard.querySelector(`a[data-discord-id="${user.sid}"]`);
                        if (discordLink) {
                            const usernameSpan = discordLink.querySelector('.discord-username');
                            if (usernameSpan) {
                                usernameSpan.textContent = discordData.username;
                            }
                        }
                    }
                }).catch(error => {
                    console.warn(`Ошибка загрузки данных Discord для ${user.sid}:`, error);
                });
                
                avatarPromises.push(avatarPromise);
            }
        });
        
        Promise.allSettled(avatarPromises).then(() => {
            console.log('Все аватары загружены');
        });
    }
    
    // Инициализация
    function init() {
        // Загрузка данных пользователей
        loadUsersData();
        // Инициализация индикаторов прокрутки
        setTimeout(updateScrollIndicators, 100);
    }
    
    // Функция для обновления индикаторов прокрутки (если нужна)
    function updateScrollIndicators() {
        // Ваша реализация здесь
    }
    
    // Запуск инициализации
    init();
});






delete window.$;
let wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
webpackChunkdiscord_app.pop();

let ApplicationStreamingStore = Object.values(wpRequire.c).find(x => x?.exports?.Z?.__proto__?.getStreamerActiveStreamMetadata).exports.Z;
let RunningGameStore = Object.values(wpRequire.c).find(x => x?.exports?.ZP?.getRunningGames).exports.ZP;
let QuestsStore = Object.values(wpRequire.c).find(x => x?.exports?.Z?.__proto__?.getQuest).exports.Z;
let ChannelStore = Object.values(wpRequire.c).find(x => x?.exports?.Z?.__proto__?.getAllThreadsForParent).exports.Z;
let GuildChannelStore = Object.values(wpRequire.c).find(x => x?.exports?.ZP?.getSFWDefaultChannel).exports.ZP;
let FluxDispatcher = Object.values(wpRequire.c).find(x => x?.exports?.Z?.__proto__?.flushWaitQueue).exports.Z;
let api = Object.values(wpRequire.c).find(x => x?.exports?.tn?.get).exports.tn;

let quest = [...QuestsStore.quests.values()].find(x => x.id !== "1412491570820812933" && x.userStatus?.enrolledAt && !x.userStatus?.completedAt && new Date(x.config.expiresAt).getTime() > Date.now())
let isApp = typeof DiscordNative !== "undefined"
if(!quest) {
  console.log("You don't have any uncompleted quests!")
} else {
  const pid = Math.floor(Math.random() * 30000) + 1000
  
  const applicationId = quest.config.application.id
  const applicationName = quest.config.application.name
  const questName = quest.config.messages.questName
  const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2
  const taskName = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"].find(x => taskConfig.tasks[x] != null)
  const secondsNeeded = taskConfig.tasks[taskName].target
  let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0

  if(taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
    const maxFuture = 10, speed = 7, interval = 1
    const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime()
    let completed = false
    let fn = async () => {      
      while(true) {
        const maxAllowed = Math.floor((Date.now() - enrolledAt)/1000) + maxFuture
        const diff = maxAllowed - secondsDone
        const timestamp = secondsDone + speed
        if(diff >= speed) {
          const res = await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: Math.min(secondsNeeded, timestamp + Math.random())}})
          completed = res.body.completed_at != null
          secondsDone = Math.min(secondsNeeded, timestamp)
        }
        
        if(timestamp >= secondsNeeded) {
          break
        }
        await new Promise(resolve => setTimeout(resolve, interval * 1000))
      }
      if(!completed) {
        await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: secondsNeeded}})
      }
      console.log("Quest completed!")
    }
    fn()
    console.log(`Spoofing video for ${questName}.`)
  } else if(taskName === "PLAY_ON_DESKTOP") {
    if(!isApp) {
      console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!")
    } else {
      api.get({url: `/applications/public?application_ids=${applicationId}`}).then(res => {
        const appData = res.body[0]
        const exeName = appData.executables.find(x => x.os === "win32").name.replace(">","")
        
        const fakeGame = {
          cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
          exeName,
          exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
          hidden: false,
          isLauncher: false,
          id: applicationId,
          name: appData.name,
          pid: pid,
          pidPath: [pid],
          processName: appData.name,
          start: Date.now(),
        }
        const realGames = RunningGameStore.getRunningGames()
        const fakeGames = [fakeGame]
        const realGetRunningGames = RunningGameStore.getRunningGames
        const realGetGameForPID = RunningGameStore.getGameForPID

        RunningGameStore.getRunningGames = () => fakeGames
        RunningGameStore.getGameForPID = (pid) => fakeGames.find(x => x.pid === pid)
        FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames})
        
        let fn = data => {
          let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value)
          console.log(`Quest progress: ${progress}/${secondsNeeded}`)
          
          if(progress >= secondsNeeded) {
            console.log("Quest completed!")
            
            RunningGameStore.getRunningGames = realGetRunningGames
            RunningGameStore.getGameForPID = realGetGameForPID
            FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: []})
            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
          }
        }
        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
        
        console.log(`Spoofed your game to ${applicationName}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`)
      })
    }
  } else if(taskName === "STREAM_ON_DESKTOP") {
    if(!isApp) {
      console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!")
    } else {
      let realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata
      ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
        id: applicationId,
        pid,
        sourceName: null
      })
      
      let fn = data => {
        let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value)
        console.log(`Quest progress: ${progress}/${secondsNeeded}`)
        
        if(progress >= secondsNeeded) {
          console.log("Quest completed!")
          
          ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc
          FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
        }
      }
      FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
      
      console.log(`Spoofed your stream to ${applicationName}. Stream any window in vc for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`)
      console.log("Remember that you need at least 1 other person to be in the vc!")
    }
  } else if(taskName === "PLAY_ACTIVITY") {
    const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL.length > 0).VOCAL[0].channel.id
    const streamKey = `call:${channelId}:1`
    
    let fn = async () => {
      console.log("Completing quest", questName, "-", quest.config.messages.questName)
      
      while(true) {
        const res = await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: false}})
        const progress = res.body.progress.PLAY_ACTIVITY.value
        console.log(`Quest progress: ${progress}/${secondsNeeded}`)
        
        await new Promise(resolve => setTimeout(resolve, 20 * 1000))
        
        if(progress >= secondsNeeded) {
          await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: true}})
          break
        }
      }
      
      console.log("Quest completed!")
    }
    fn()
  }
}
