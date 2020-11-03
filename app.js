const serverless = require('serverless-http');
const express = require('express');
const app = express();
const AWS = require('aws-sdk');
const S3= new AWS.S3();
const csv = require('csvtojson');
const converter = require('json-2-csv');
const S3Bucket = "your bucket name";

app.all("/*", function(req, res, next){
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    next();
});

app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.json({limit: '100mb'}));

getCSVFromS3 = async(params)=>{
    // get csv file and create stream
    const stream = S3.getObject(params).createReadStream();
    // convert csv file (stream) to JSON format data
    const json = await csv().fromStream(stream);
    return json;
}

getObjectFromS3 = async(params, callback)=>{
    // get csv file and create stream
    const response = await S3.getObject(params).promise();
    const jsonData = JSON.parse(response.Body.toString('utf-8'));
    callback(jsonData);
}

updateCellToS3 = async(value, customerName, documentType, params, res)=>{
    const data = await S3.getObject(params).promise();
    const documentMap = JSON.parse(data.Body.toString('utf-8'));
    const filePath = documentMap[customerName];
    params.Key = "data/"+filePath;
    let fileData = await getCSVFromS3(params);
    bUpdated = false;
    for(let i = 0; i< fileData.length; i++) {
        if(fileData[i]['Document Type'] === documentType) {
            console.log(fileData[i]['Document Type']);
            fileData[i]['Customer Document Type'] = value;
            bUpdated = true;
            break;
        }
    }
    //Entry doesn't exist, have to create a new one.
    if(!bUpdated) {
        fileData.push({
            'Document Type':documentType,
            'Customer Document Type':value
        })
    }
    const putParams = {
        Bucket: params.Bucket,
        Key:params.Key
    }
    //console.log(fileData);
    // convert JSON array to CSV string
    converter.json2csv(fileData, (err, csv) => {
        if (err) {
            throw err;
        }
        // upload updated CSV to S3
        const bufferObject = new Buffer.from(csv);
        putParams.Body = bufferObject;
        S3.putObject(putParams, function(err) {
            if (err) {
                console.log("Error at uploadCSVFileOnS3Bucket function",err);
                res.send({status:400});
            } else {
                console.log("File uploaded successfully");
                res.send({status:200});
            }
        });
    });
}

fetchAllDocuments = async(params,resolve)=>{
    params.Key = "data/customers-file-map.json";
    const customerData = await S3.getObject(params).promise();
    const customerMap = JSON.parse(customerData.Body.toString('utf-8'));
    params.Key = "data/documents-file-map.json";
    const documentData = await S3.getObject(params).promise();
    const documentMap = JSON.parse(documentData.Body.toString('utf-8'));
    let dataMap = {};
    let data = {};
    let filePath = null;
    params = {
      Bucket:S3Bucket,
      Key: null
    }
    for(let customer in customerMap) {
      filePath = customerMap[customer];
      params.Key = "data/"+filePath;
      dataMap[customer] = await getCSVFromS3(params);
    }
    data = {dataMap:dataMap, documentMap:documentMap};
    //console.log("All data fetched");
    resolve(data);
}

fetchDataElement = async(params,resolve)=>{
    params.Key = "data/extractions/data-elements.csv";
    const fileData = await getCSVFromS3(params);
    resolve({dataElements: fileData});
}

app.get('/listCustomers', (req, res) => {
    let params = {
        Bucket:S3Bucket,
        Key: null
    }
    const promise1 = new Promise((resolve) => {
        fetchAllDocuments(params,resolve);
    });
    const promise2 = new Promise((resolve) => {
        fetchDataElement(params,resolve)
    });
    Promise.all([promise1, promise2]).then(values => { 
        res.send({status:200, values:values}); 
    })

});
app.post('/updateValue', (req, res) => {
    const value = req.body.value;
    const customerName = req.body.customerName;
    const documentType = req.body.documentType;
    const params = {
        Bucket:S3Bucket,
        Key: "data/customers-file-map.json"
    }
    updateCellToS3(value, customerName, documentType, params,res);
});
app.post('/uploadPDF', (req, res) => {
    const fileName = req.body.fileName;
    let params = {
        Bucket:S3Bucket,
        Key: "data/samples/" + fileName + ".pdf",
        ACL: 'public-read',
        Body: Buffer.from(req.body.requestData.replace("data:application/pdf;base64,",""),'base64'),
        ContentType : 'application/pdf'
    };
    S3.putObject(params, function(err) {
        if (err) {
            console.log("Error at uploadCSVFileOnS3Bucket function",err);
            res.send({status:400, err:err});
        } else {
            console.log(fileName + " File uploaded successfully");
            params = {
                Bucket:S3Bucket,
                Key:"data/documents-file-map.json"
            };
            getObjectFromS3(params, function(jsonData) {
                jsonData[fileName] = "samples/" + fileName + ".pdf";
                params.Body = JSON.stringify(jsonData);
                S3.putObject(params, function(err) {
                    if (err) {
                        console.log("Error at updating document file",err);
                        res.send({status:400, documentType:fileName,err:err});
                    } else {
                        console.log(fileName + " added to document map successfully");
                        res.send({status:200, documentType: fileName, documentPath: "samples/" + fileName + ".pdf"});
                    }
                });
            });
        }
    });
})
app.post('/createCustomer', (req, res) => {
    const customerName = req.body.costomerName;
    console.log(customerName);
    const params = {
        Bucket:S3Bucket,
        Key: "data/customers-file-map.json"
    }
    getObjectFromS3(params, function(data){
        if(data[customerName]) {
            res.send({status:400, message:"Customer Already Exist!"}); 
        } else {
            data[customerName] = "classifications/" + customerName + ".csv";
            params.Body = JSON.stringify(data);
            const promise1 = new Promise((resolve, reject) => {
                S3.putObject(params, function(err) {
                    if (err) {
                        console.log("Error updating customer map ", err);
                        reject(new Error());
                    } else {
                        console.log("Customer map updated.");
                        resolve("");
                    }
                });
            });
            const promise2 = new Promise((resolve, reject) => {
                params.Key = "data/classifications/" + customerName + ".csv";
                params.Body = "";
                S3.putObject(params, function(err) {
                    if (err) {
                        console.log("Error creating new customer csv ", err);
                        reject(new Error());
                    } else {
                        console.log("New customer csv created.");
                        resolve("");
                    }
                });
            });
            Promise.all([
                promise1.catch(error => {res.send({status:400, message:"Error Updating Customer Map!"});}),
                promise2.catch(error => {res.send({status:400, message:"Error Creating New CSV!"});})
            ]).then(values => { 
                res.send({status:200, customerName:customerName, path: 'classifications/" + customerName + ".csv"'}); 
            })
        }
    })
});
app.post('/createDocument', (req, res) => {
    const documentType = req.body.documentType;
    const params = {
        Bucket:S3Bucket,
        Key:"data/documents-file-map.json"
    }
    getObjectFromS3(params, function(data){
        if(data[documentType]) {
            res.send({status:400, message:"Customer Already Exist!"}); 
        } else {
            data[documentType] = "";
            params.Body = JSON.stringify(data);
            S3.putObject(params, function(err) {
                if (err) {
                    console.log("Error updating document map ", err);
                    res.send({status:400, message:"Error Creating New Document Type!"});
                } else {
                    console.log("Document map updated.");
                    res.send({status:200, documentType:documentType}); 
                }
            });
        }
    })
});
app.get('/api/info', (req, res) => {
  res.send({ application: 'sample-app', version: '1' });
});
app.post('/api/v1/getback', (req, res) => {
  res.send({ ...req.body });
});
//Uncomment this line for running from local
//app.listen(3000, () => console.log(`Listening on: 3000`));

//Uncomment this line for deploy to aws
module.exports.handler = serverless(app);