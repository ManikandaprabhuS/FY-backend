import {startReviewWorker} from "./modules/reviews/reviews.worker";
import {seedOffers} from "./modules/offers/offers.seed";
import {app} from "./app";
import {env} from "./config/env";
import {logger} from "./config/logger";
import {prisma} from "./prisma/client";
import {createServer} from "node:http";
const server=createServer(app);
void seedOffers().then(()=>{
 server.listen(env.PORT,()=>{
  logger.info({port:env.PORT,environment:env.NODE_ENV},"FrameYaad API started");
  console.log("Application is running on",env.PORT);
  startReviewWorker();
 });
}).catch((error:unknown)=>{
 logger.error({err:error},"Offer initialization failed; API was not started");
 void prisma.$disconnect();process.exitCode=1;
});
const shutdown=(signal:NodeJS.Signals):void=>{
 logger.info({signal},"Shutting down FrameYaad API");
 server.close(()=>{void prisma.$disconnect().finally(()=>process.exit(0));});
 setTimeout(()=>process.exit(1),10000).unref();
};
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);

