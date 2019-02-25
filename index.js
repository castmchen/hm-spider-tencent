var http = require('http');
var express = require('express');
var fs = require('fs');
var path = require('path');
var bodyParser = require('body-parser');
var request = require('request');
var _ = require('underscore');

var videoList = [];
var app = express();
var server = http.createServer(app);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.engine('.html', require('ejs').__express);
app.set('view engine', 'html');
app.set('views', path.resolve(__dirname, 'views'));

app.get('/', function(req, res) {
    res.render('index.html', { urlList: [] });
});

app.get('/videourl', function(req, res) {
    var query = req.query;
    getVideoUrl(query.path, function(error, urlList) {
        res.render('video.html', { urlList: urlList });
    })
});

app.get('/api/videourl', function(req, res) {
    var query = req.query;
    getVideoUrl(query.path, function(error, urlList) {
        res.json({ urlList: urlList });
    })
});

app.get('/api/keyword', function(req, res) {
    if (typeof req.query == 'undefined' || req.query == null || req.query == '') {
        res.send({ result: 'fail' })
    }
    var keyword = req.query.keyword;
    if (keyword == null || keyword === "") {
        res.send({ result: 'fail' })
    }
    var pageNumber = req.query.num;
    if (typeof pageNumber == 'undefined' || pageNumber == "") {
        pageNumber = 1
    }

    getVideoUrlsFromTencent(keyword, pageNumber, function(error, videoUrls) {
        if (error) {
            res.send({ result: error })
        }
        if (typeof videoUrls == 'undefined' || videoUrls == null || !videoUrls.length || typeof videoUrls === "string") {
            res.send({ result: 'fail' })
        }

        getVideoRealPlayUrl(videoUrls, function(result) {
            res.send({ result: result })
        });
    });
})

function getVideoUrlsFromTencent(keyword, pageNumber, callback) {
    if (!pageNumber) {
        pageNumber = 1
    }

    var searchUrlOfTencent = "https://v.qq.com/x/search/?q=" + keyword + "&cur=" + pageNumber;
    request.get(encodeURI(searchUrlOfTencent), { contentType: 'json' }, function(error, response, body) {
        if (error || response.statusCode != 200) {
            callback(error, null)
            return
        }
        getVideoUrlFromBody(body, [], function(videoUrls) {
            callback(error, videoUrls)
        });
    });
}

function getVideoUrlFromBody(htmlString, result, callback) {
    var startIndex = htmlString.indexOf('<h2 class="result_title">');
    if (startIndex < 0) {
        callback(result);
        return
    }

    var newHtmlString = htmlString.slice(startIndex, htmlString.length)
    var titleFlag = newHtmlString.indexOf('</h2>')
    if (titleFlag < 0) {
        callback(result)
        return
    }

    var titleString = newHtmlString.slice(0, titleFlag + 5)

    if (titleString.indexOf('<a href=') > -1) {
        var urlStartIndex = titleString.indexOf('<a href=') + 9
        var urlEndIndex = titleString.indexOf('" ')

        var videoUrl = titleString.substring(urlStartIndex, urlEndIndex)
        var videoTitle = titleString.match(/[\u4e00-\u9fa5]/g).join('')
        result.push({ title: videoTitle, videoPath: videoUrl })
    }

    var bodyForNext = newHtmlString.slice(titleFlag + 6)
    getVideoUrlFromBody(bodyForNext, result, callback)
}

function getVideoRealPlayUrl(videoList, callback, index, result) {
    if (typeof index == 'undefined') {
        index = 0
    }
    if (typeof result == 'undefined') {
        result = []
    }


    request.get(videoList[index].videoPath, function(error, response, body) {
        if (error || response.statusCode != 200) {
            if (index + 1 < videoList.length - 1) {
                getVideoRealPlayUrl(videoList, callback, index + 1, result);
            } else {
                callback(result)
            }
        }

        var videoInfoReg = /VIDEO_INFO = ({[^}]*})/;
        var videoMatch = body.match(videoInfoReg) && body.match(videoInfoReg)[1] || '{}';
        var videoInfo = jsonParse(videoMatch) || {};

        var params = {
            'isHLS': false,
            'charge': 0,
            'vid': videoInfo.vid,
            'defaultfmt': 'auto',
            'defn': 'shd',
            'defnpayver': 1,
            'otype': 'json',
            'platform': 11001,
            'sdtfrom': 'v1103',
            'host': 'v.qq.com'
        };

        var baseUrl = 'http://h5vv.video.qq.com/getinfo?callback=formatParams&';
        var paramsArr = [];
        for (var key in params) {
            paramsArr.push('' + key + '=' + params[key]);
        }
        var paramsStr = paramsArr.join('&');
        var targetUrl = baseUrl + paramsStr
        request.get(targetUrl, { contentType: 'json' }, function(error, response, body) {
            var videoArray = eval(body);
            if (videoArray != null && videoArray.length) {
                result.push({ title: videoList[index].title, url: videoArray[videoArray.length - 1] });
            }
            if (index + 1 <= videoList.length - 1) {
                getVideoRealPlayUrl(videoList, callback, index + 1, result);
            } else {
                callback(result);
            }
        });
    });

    function formatParams(para) {
        var result = [];
        var vi = para && para.vl && para.vl.vi || [];
        for (var i = 0, len = vi.length; i < len; i++) {
            var fileName = vi[i].fn;
            var fvkey = vi[i].fvkey;
            var ui = vi[i].ul.ui;
            for (var j = 0; j < ui.length; j++) {
                result.push(ui[j].url + fileName + '?vkey=' + fvkey + '&sdtfrom=v1103');
            }
        }
        return result;
    }

    function jsonParse(str) {
        str = str.replace(/\s+/g, '');
        str = str.replace(/\"+/g, '');
        str = str.replace(/\'+/g, '');
        str = str.substr(1, str.length - 1);
        var arr = str.split(',');
        var result = {},
            temp;
        for (var i = 0, len = arr.length; i < len; i++) {
            temp = arr[i].split(':');
            result[temp[0]] = temp[1];
        }
        return result;
    }
}

function getVideoUrl(path, callback) {
    request.get(path, function(err, response, body) {
        var videoInfoReg = /VIDEO_INFO = ({[^}]*})/;
        var listInfoReg = /LIST_INFO = ({[^}]*})/;
        var videoMatch = body.match(videoInfoReg) && body.match(videoInfoReg)[1] || '{}';
        var listMatch = body.match(listInfoReg) && body.match(listInfoReg)[1] || '{}';
        var videoInfo = jsonParse(videoMatch) || {};
        var listInfo = jsonParse(listMatch) || {};

        var params = {
            'isHLS': false,
            'charge': 0,
            'vid': videoInfo.vid,
            'defaultfmt': 'auto',
            'defn': 'shd',
            'defnpayver': 1,
            'otype': 'json',
            'platform': 11001,
            'sdtfrom': 'v1103',
            'host': 'v.qq.com',
            // 'fhdswitch': 0,
            // 'show1080p': 0,
            // 'guid': '8e66ae036ed5662c168c925a0efd5014',
            // 'flowid': 'db40b1fce11f76377c845c1cef95fae4_70901',
            // 'defnpayver': 0,
            // 'appVer': '3.3.131',
            // 'ehost': 'https%3A%2F%2Fm.v.qq.com%2Fplay.html%3F%26vid%3Dl0560fsmenm%26ptag%3Dv_qq_com%2523v.play.adaptor%25233',
            // 'sphttps': 1,
            // '_rnd': 1508213457,
            // 'spwm': 4,
            // 'defn': 'auto',
            // 'fmt': 'auto',
            // 'defsrc': 1
        };

        var baseUrl = 'http://h5vv.video.qq.com/getinfo?callback=formatParams&';
        var paramsArr = [];
        for (var key in params) {
            paramsArr.push('' + key + '=' + params[key]);
        }
        var paramsStr = paramsArr.join('&');
        request.get(baseUrl + paramsStr, { contentType: 'json' }, function(error, response, body) {
            var urlList = eval(body);
            callback(null, urlList);
            // 
        });
    });

    function formatParams(para) {
        var result = [];
        var vi = para && para.vl && para.vl.vi || [];
        for (var i = 0, len = vi.length; i < len; i++) {
            var fileName = vi[i].fn;
            var fvkey = vi[i].fvkey;
            var ui = vi[i].ul.ui;
            for (var j = 0; j < ui.length; j++) {
                result.push(ui[j].url + fileName + '?vkey=' + fvkey + '&sdtfrom=v1103');
            }
        }
        return result;
    }

    function jsonParse(str) {
        str = str.replace(/\s+/g, '');
        str = str.replace(/\"+/g, '');
        str = str.replace(/\'+/g, '');
        str = str.substr(1, str.length - 1);
        var arr = str.split(',');
        var result = {},
            temp;
        for (var i = 0, len = arr.length; i < len; i++) {
            temp = arr[i].split(':');
            result[temp[0]] = temp[1];
        }
        return result;
    }
}

var port = process.env.PORT || 1337;
server.listen(port, function() {
    console.log('https server is running at http://localhost:%d', port);
})
