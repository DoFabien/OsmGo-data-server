var express = require('express');
var compression = require('compression');
global.DOMParser = require('xmldom').DOMParser;
fs = require('fs');
var cors = require('cors');
var request = require('sync-request');

var osmtogeojson = require('./lib/osmtogeojson');
var bodyParser = require('body-parser');
var turf = require('turf');

var app = express();


app.use(cors());
app.use(compression());
app.use(bodyParser.json())
// app.use(express.bodyParser());

function getPrimaryKeyOfObject(tags, keys) {

    let kv = { k: '', v: '' };
    for (let k in tags) {
        if (keys.indexOf(k) !== -1) {
            kv = { k: k, v: tags[k] };
            return kv
        }
    }
    return null;
}

function filterGeojson(geojson, keys, filterKeys) {
    let features = geojson.features;
    let filterFeatures = [];
    for (let i = 0; i < features.length; i++) {
        let feature = features[i];
        if (!feature.properties.tainted) { // !relation incomplete
            let primaryTag = getPrimaryKeyOfObject(feature.properties.tags, keys);
                if (primaryTag) { // !aucun tag interessant
                    feature.properties['primaryTag'] = primaryTag;
                    filterFeatures.push(feature);
                }
        }
    }
    return { "type": "FeatureCollection", "features": filterFeatures };
}

function wayToPoint(FeatureCollection) {
    let features = FeatureCollection.features;
    for (let i = 0; i < features.length; i++) {
        let feature = features[i];
        if (feature.geometry) {
            if (feature.geometry.type !== 'Point') {
                // on stocke la géométrie d'origine dans .way_geometry
                feature.properties.way_geometry = JSON.parse(JSON.stringify(feature.geometry));
                let geom;
                switch (feature.geometry.type) {
                    case 'Polygon':
                        geom = turf.polygon(feature.geometry.coordinates);
                        break;
                    case 'MultiPolygon':
                        geom = turf.multiPolygon(feature.geometry.coordinates);
                        break;
                    case 'LineString':
                        geom = turf.lineString(feature.geometry.coordinates);
                        break;
                    case 'MultiLineString':
                        geom = turf.multiLineString(feature.geometry.coordinates);
                        break;
                }

                if (geom) {
                    feature.geometry.coordinates = turf.pointOnSurface(geom).geometry.coordinates;
                    feature.geometry.type = 'Point';
                }
            }
        }

    }
    return FeatureCollection;
}

function getUrlOverpassApi(bbox, keys) {

    let OPapiBbox = bbox[1] + ',' + bbox[0] + ',' + bbox[3] + ',' + bbox[2];
    // console.log(OPapiBbox)
    let queryContent = '';
    for (let i = 0; i < keys.length; i++) {
        let key = keys[i];
        queryContent = queryContent + 'node["' + key + '"](' + OPapiBbox + ');';
        queryContent = queryContent + 'way["' + key + '"](' + OPapiBbox + ');'
        queryContent = queryContent + 'relation["' + key + '"](' + OPapiBbox + ');'
    }
    let query = '[out:xml][timeout:25];(' + queryContent + ');out meta;>;out meta;'
    return query;
}


app.get('/', function (req, res) {
    console.log(req.query)
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader('charset', 'utf-8');
    res.end('Coucou toi');
});




app.get('/api06', function (req, res) {
    console.log('api06')
    res.setHeader('Content-Type', 'application/json');
    res.setHeader("Access-Control-Allow-Origin", "*");
    //res.setHeader('charset', 'utf-8');

    let bboxs = req.query.bbox.split(',');
    let keys = req.query.keys.split(',');
    // request to API06
    let urlApi06 = 'http://api.openstreetmap.org/api/0.6/map?bbox=' + bboxs.join(',');
    console.log(urlApi06);
    let resApi06 = request('GET', urlApi06, { 'headers': { 'charset': 'utf8' } });
    if (resApi06.statusCode !== 200) {
        console.log(resApi06.statusCode)
        return null;
    }
    let osmDataStr = resApi06.getBody('utf8');

    let parser = new DOMParser();
    let osmXml = parser.parseFromString(osmDataStr, "application/xml"); // => toXML
    let geojson = osmtogeojson(osmXml).geojson; // => to Geojson
    let geojsonClean = filterGeojson(geojson, keys, true) //=> filter, keys && relation complete seulement

    res.end(JSON.stringify(wayToPoint(geojsonClean)));
});

app.get('/overpassApi', function (req, res) {
    console.log('overpassApi')
    res.setHeader('Content-Type', 'application/json');
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader('charset', 'utf-8');

    let bboxs = req.query.bbox.split(',');
    let keys = req.query.keys.split(',');
    let urlOverpassApi = 'http://api.openstreetmap.fr/oapi/interpreter';
    let requestBody = getUrlOverpassApi(bboxs, keys);

    let resOverpass = request('Post', urlOverpassApi, { 'body': requestBody, 'headers': { 'charset': 'utf8' } });    
    if (resOverpass.statusCode !== 200) {
        console.log(resOverpass.statusCode)
        return null;
    }
    let osmDataStr = resOverpass.getBody('utf8');
    let parser = new DOMParser();
    let osmXml = parser.parseFromString(osmDataStr, "application/xml"); // => toXML
    let geojson = osmtogeojson(osmXml).geojson; // => to Geojson
    let geojsonClean = filterGeojson(geojson, keys, true) //=> filter, keys && relation complete seulement

    res.end(JSON.stringify(wayToPoint(geojsonClean)));

});


app.listen(6080);